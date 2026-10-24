import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlannedMosaic } from '../services/ffmpeg-manager.js';
import type { MediamtxService } from '../services/mediamtx-service.js';

/**
 * Regression test for a real bug: the no-first-frame watchdog killed a hung
 * FFmpeg start via `proc.stop()` intending to "treat the start as failed"
 * (per its own log message), but FfmpegProcess reports every SIGTERM-killed
 * exit as `reason: 'stopped'` — indistinguishable from a deliberate
 * `requestStop()` — so `onExit()` silently parked the mosaic in `stopped`
 * with no retry, no backoff, and no visible error. From the UI this looked
 * exactly like "it tries to start, then stops." Only reproducible by driving
 * the real watchdog timer through a real exit event — a test that only
 * checks `scheduleRestart()` or the exit-reason classifier in isolation
 * would not catch this, since the bug is specifically in how the two are
 * wired together in `onExit()`.
 */

// vi.mock(...) is hoisted above every import (even `node:events`), so the
// fake class is hand-rolled without extending the real EventEmitter to avoid
// a temporal-dead-zone reference error inside vi.hoisted().
const { FakeProc, instances } = vi.hoisted(() => {
  const instances: InstanceType<typeof FakeProcClass>[] = [];
  class FakeProcClass {
    pid = 4242;
    stopCalls = 0;
    private listeners = new Map<string, Array<(...a: unknown[]) => void>>();
    constructor(public opts: unknown) {
      instances.push(this);
    }
    on(event: string, cb: (...a: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
      return this;
    }
    emit(event: string, payload?: unknown): void {
      for (const cb of this.listeners.get(event) ?? []) cb(payload);
    }
    start(): void {
      /* no real spawn */
    }
    async stop(_graceMs = 5000): Promise<void> {
      this.stopCalls += 1;
      // What a real FfmpegProcess reports for any SIGTERM-killed exit,
      // regardless of who requested the stop or why (see ffmpeg-process.ts).
      this.emit('exit', {
        code: null,
        signal: 'SIGTERM',
        reason: 'stopped',
        culpritPositions: [],
        durationMs: 1,
      });
    }
    stderrSnapshot(): string[] {
      return [];
    }
  }
  return { FakeProc: FakeProcClass, instances };
});

vi.mock('../services/ffmpeg-process.js', () => ({ FfmpegProcess: FakeProc }));

import { resetDb } from './helpers.js';
import { MosaicRunner } from '../services/ffmpeg-manager.js';

const fakeMediamtx = { ensurePath: vi.fn(async () => undefined) } as unknown as MediamtxService;

const plan: PlannedMosaic = {
  mosaicId: 'm1',
  slug: 'm1',
  build: { bin: 'ffmpeg', args: [], inputIndexToPosition: [], pretty: 'ffmpeg …' } as unknown as PlannedMosaic['build'],
  encoderId: 'libx264',
  expectedFps: 15,
  expectedWidth: 640,
  expectedHeight: 360,
  expectedBitrateKbps: 2000,
  tiles: [],
  positionCameraId: {},
  referencedCameraIds: [],
};

beforeEach(() => {
  resetDb();
  instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MosaicRunner no-first-frame watchdog', () => {
  it('retries instead of silently settling in "stopped" when FFmpeg produces no output in time', async () => {
    const planFn = vi.fn(async () => plan);
    const runner = new MosaicRunner('m1', planFn, fakeMediamtx);
    await runner.requestStart();
    expect(runner.state).toBe('starting');

    // Past the watchdog window: max(15000, rtspReadTimeoutMs*2) = 30000ms with defaults.
    await vi.advanceTimersByTimeAsync(30_001);

    expect(instances[0]!.stopCalls).toBe(1); // watchdog actually fired
    expect(runner.state).not.toBe('stopped'); // must not silently give up
    expect(runner.state).toBe('restarting');
    expect(runner.lastError).toMatch(/no output/i);
  });

  it('a genuine requestStop() still lands cleanly in "stopped" with no retry (unaffected by the fix)', async () => {
    const planFn = vi.fn(async () => plan);
    const runner = new MosaicRunner('m1', planFn, fakeMediamtx);
    await runner.requestStart();
    await runner.requestStop();
    expect(runner.state).toBe('stopped');
    expect(runner.lastError).toBeNull();
  });
});
