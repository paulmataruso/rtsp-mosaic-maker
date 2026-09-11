import pidusage from 'pidusage';
import { FfmpegProcess, type FfmpegExit, type FfmpegProgress } from './ffmpeg-process.js';
import type { BuiltCommand } from './ffmpeg-command.js';
import { bus } from '../lib/event-bus.js';
import { logStore } from '../lib/log-store.js';
import { pollLoop, sleep } from '../lib/async.js';
import { backoffDelay } from 'shared';
import { loadEnv } from '../config/env.js';
import { getSettings } from '../db/repo/settings.js';
import type { MediamtxService } from './mediamtx-service.js';
import type {
  MosaicState,
  MosaicStatus,
  MosaicMetrics,
  MosaicTileStatus,
  HealthLevel,
  EncoderId,
} from 'shared';

export interface PlannedMosaic {
  mosaicId: string;
  slug: string;
  build: BuiltCommand;
  encoderId: EncoderId;
  expectedFps: number;
  expectedWidth: number;
  expectedHeight: number;
  expectedBitrateKbps: number;
  tiles: MosaicTileStatus[];
  /** position -> cameraId for every camera-backed cell (live or placeholder). */
  positionCameraId: Record<number, string>;
  referencedCameraIds: string[];
}

export type PlanFn = (
  mosaicId: string,
  ctx: { suspectCameraIds: Set<string> },
) => Promise<PlannedMosaic>;

const emptyMetrics = (): MosaicMetrics => ({
  fps: null,
  bitrateKbps: null,
  frames: null,
  dropFrames: null,
  dupFrames: null,
  speed: null,
  cpuPercent: null,
  memoryMb: null,
});

class MosaicRunner {
  state: MosaicState = 'created';
  private proc: FfmpegProcess | undefined;
  private plan: PlannedMosaic | undefined;
  restartCount = 0;
  lastExitCode: number | null = null;
  lastError: string | null = null;
  backoffUntil: number | null = null;
  startedAt: number | null = null;
  metrics: MosaicMetrics = emptyMetrics();
  readonly suspectCameraIds = new Set<string>();
  private stopRequested = false;
  private restartTimer: NodeJS.Timeout | undefined;
  private healthyTimer: NodeJS.Timeout | undefined;
  private watchdog: NodeJS.Timeout | undefined;
  private lastProgressAt = 0;
  private degradedReason: string | null = null;

  constructor(
    readonly mosaicId: string,
    private readonly planFn: PlanFn,
    private readonly mediamtx: MediamtxService,
    readonly probeCameras?: (cameraIds: string[]) => void,
  ) {}

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get running(): boolean {
    return ['starting', 'running', 'degraded', 'restarting'].includes(this.state);
  }

  get referencedCameraIds(): string[] {
    return this.plan?.referencedCameraIds ?? [];
  }

  private emit(): void {
    bus.emit('mosaic.status', this.getStatus());
  }

  private clearTimers(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.restartTimer = this.healthyTimer = this.watchdog = undefined;
  }

  async requestStart(): Promise<void> {
    this.stopRequested = false;
    this.restartCount = 0;
    this.suspectCameraIds.clear();
    await this.launch();
  }

  async requestStop(): Promise<void> {
    this.stopRequested = true;
    this.clearTimers();
    this.backoffUntil = null;
    if (this.proc) {
      await this.proc.stop(6000);
      this.proc = undefined;
    }
    this.state = 'stopped';
    this.metrics = emptyMetrics();
    logStore.push('info', 'ffmpeg', `Mosaic stopped by request.`, {
      mosaicId: this.mosaicId,
      slug: this.plan?.slug ?? null,
    });
    this.emit();
  }

  async requestRestart(): Promise<void> {
    logStore.push('info', 'ffmpeg', 'Mosaic restart requested.', {
      mosaicId: this.mosaicId,
      slug: this.plan?.slug ?? null,
    });
    await this.requestStop();
    await this.requestStart();
  }

  notifyCameraRecovered(cameraId: string): void {
    if (!this.running) return;
    if (this.suspectCameraIds.delete(cameraId)) {
      logStore.push(
        'info',
        'ffmpeg',
        `Camera recovered — restarting mosaic to restore its tile.`,
        { mosaicId: this.mosaicId, cameraId, slug: this.plan?.slug ?? null },
      );
      void this.softReload();
    }
  }

  /** Re-plan + relaunch without resetting the restart counter (tile swap). */
  private async softReload(): Promise<void> {
    if (this.stopRequested) return;
    if (this.proc) {
      await this.proc.stop(6000);
      this.proc = undefined;
    }
    await this.launch();
  }

  private async launch(): Promise<void> {
    if (this.stopRequested) return;
    this.clearTimers();
    this.state = this.restartCount > 0 ? 'restarting' : 'starting';
    this.backoffUntil = null;
    this.emit();

    // Ensure the MediaMTX path exists (retry-safe; failure -> backoff).
    try {
      await this.mediamtx.ensurePath(
        (this.plan?.slug ?? (await this.peekSlug())) || this.mosaicId,
        this.mosaicId,
      );
    } catch (err) {
      this.lastError = `MediaMTX not ready: ${(err as Error).message}`;
      logStore.push('warn', 'ffmpeg', this.lastError, { mosaicId: this.mosaicId });
      this.scheduleRestart('MediaMTX not ready');
      return;
    }

    let plan: PlannedMosaic;
    try {
      plan = await this.planFn(this.mosaicId, { suspectCameraIds: this.suspectCameraIds });
    } catch (err) {
      this.lastError = (err as Error).message;
      this.state = 'failed';
      logStore.push('error', 'ffmpeg', `Cannot start mosaic: ${this.lastError}`, {
        mosaicId: this.mosaicId,
      });
      this.emit();
      return;
    }
    this.plan = plan;

    const placeholders = plan.tiles.filter((t) => t.render === 'placeholder').length;
    this.degradedReason =
      placeholders > 0 ? `${placeholders} camera tile(s) showing OFFLINE placeholder` : null;

    logStore.push(
      'info',
      'ffmpeg',
      `Starting FFmpeg for "/${plan.slug}" (${plan.expectedWidth}×${plan.expectedHeight} @ ${plan.expectedFps} fps, ${plan.encoderId})`,
      { mosaicId: this.mosaicId, slug: plan.slug },
    );
    logStore.push('debug', 'ffmpeg', plan.build.pretty, { mosaicId: this.mosaicId, slug: plan.slug });

    const proc = new FfmpegProcess({
      bin: plan.build.bin,
      args: plan.build.args,
      inputIndexToPosition: plan.build.inputIndexToPosition,
      mosaicId: this.mosaicId,
      slug: plan.slug,
      pretty: plan.build.pretty,
    });
    this.proc = proc;
    this.startedAt = Date.now();
    this.lastProgressAt = 0;
    this.metrics = emptyMetrics();

    proc.on('progress', (p) => this.onProgress(p));
    proc.on('stderr', ({ line, level }) =>
      logStore.push(level, 'ffmpeg', line, { mosaicId: this.mosaicId, slug: plan.slug }),
    );
    proc.on('input-error', ({ position, message }) => this.onInputError(position, message));
    proc.on('exit', (exit) => this.onExit(exit));

    try {
      proc.start();
    } catch (err) {
      this.onExit({
        code: null,
        signal: null,
        reason: `spawn failed: ${(err as Error).message}`,
        culpritPositions: [],
        durationMs: 0,
      });
      return;
    }

    this.state = this.degradedReason ? 'degraded' : 'starting';
    this.emit();

    // Watchdog: expect first progress within a bounded window.
    const settings = getSettings();
    const graceMs = Math.max(15000, settings.rtspReadTimeoutMs * 2);
    this.watchdog = setTimeout(() => {
      if (this.lastProgressAt === 0 && this.proc === proc) {
        logStore.push(
          'warn',
          'ffmpeg',
          `No output after ${Math.round(graceMs / 1000)}s — treating start as failed.`,
          { mosaicId: this.mosaicId, slug: plan.slug },
        );
        void proc.stop(2000);
      }
    }, graceMs);

    // Healthy reset: after a clean run, forgive past failures.
    this.healthyTimer = setTimeout(() => {
      if (this.proc === proc && this.running) {
        if (this.restartCount > 0) {
          logStore.push('info', 'ffmpeg', 'Mosaic healthy — restart counter reset.', {
            mosaicId: this.mosaicId,
            slug: plan.slug,
          });
        }
        this.restartCount = 0;
      }
    }, settings.reconnectMaxDelayMs + 60000);
  }

  private async peekSlug(): Promise<string> {
    try {
      const p = await this.planFn(this.mosaicId, { suspectCameraIds: this.suspectCameraIds });
      this.plan = p;
      return p.slug;
    } catch {
      return '';
    }
  }

  private onProgress(p: FfmpegProgress): void {
    this.lastProgressAt = Date.now();
    this.metrics = {
      ...this.metrics,
      fps: p.fps ?? this.metrics.fps,
      bitrateKbps: p.bitrateKbps ?? this.metrics.bitrateKbps,
      frames: p.frame ?? this.metrics.frames,
      dropFrames: p.dropFrames ?? this.metrics.dropFrames,
      dupFrames: p.dupFrames ?? this.metrics.dupFrames,
      speed: p.speed ?? this.metrics.speed,
    };
    if (this.state === 'starting' || this.state === 'restarting') {
      this.state = this.degradedReason ? 'degraded' : 'running';
      logStore.push('info', 'ffmpeg', `Mosaic is publishing to "/${this.plan?.slug}".`, {
        mosaicId: this.mosaicId,
        slug: this.plan?.slug ?? null,
      });
    }
    this.emit();
  }

  private onInputError(position: number, message: string): void {
    const cameraId = this.plan?.positionCameraId[position];
    if (cameraId && !this.suspectCameraIds.has(cameraId)) {
      this.suspectCameraIds.add(cameraId);
      logStore.push(
        'warn',
        'ffmpeg',
        `Input error on tile ${position} (${message.slice(0, 160)}) — will render it as OFFLINE on next (re)start.`,
        { mosaicId: this.mosaicId, cameraId, slug: this.plan?.slug ?? null },
      );
    }
  }

  private onExit(exit: FfmpegExit): void {
    this.clearTimers();
    this.lastExitCode = exit.code;
    const proc = this.proc;
    this.proc = undefined;
    this.metrics = emptyMetrics();

    if (this.stopRequested || exit.reason === 'stopped') {
      this.state = 'stopped';
      this.emit();
      return;
    }

    this.lastError = exit.reason;
    // Blame specific cameras so the next attempt substitutes a placeholder.
    for (const pos of exit.culpritPositions) {
      const cameraId = this.plan?.positionCameraId[pos];
      if (cameraId) this.suspectCameraIds.add(cameraId);
    }
    // Ask the monitor to re-check every referenced camera right now, so a dead
    // one is flagged well before the next 30s health sweep and the next
    // restart can render it as an OFFLINE placeholder.
    if (this.restartCount >= 1 && this.probeCameras) {
      this.probeCameras(this.plan?.referencedCameraIds ?? []);
    }

    const stderrTail = proc?.stderrSnapshot().slice(-4).join(' | ') ?? '';
    logStore.push(
      'error',
      'ffmpeg',
      `Mosaic "/${this.plan?.slug}" stopped: ${exit.reason}` +
        (exit.code !== null ? ` (exit ${exit.code})` : '') +
        (stderrTail ? ` — ${stderrTail}` : ''),
      { mosaicId: this.mosaicId, slug: this.plan?.slug ?? null },
    );

    this.scheduleRestart(exit.reason);
  }

  private scheduleRestart(reason: string): void {
    this.restartCount += 1;
    const settings = getSettings();
    if (this.restartCount > settings.maxRestartAttempts) {
      this.state = 'failed';
      this.backoffUntil = null;
      logStore.push(
        'error',
        'ffmpeg',
        `Mosaic "/${this.plan?.slug}" failed permanently after ${settings.maxRestartAttempts} restart attempts (${reason}). Fix the issue and start it again.`,
        { mosaicId: this.mosaicId, slug: this.plan?.slug ?? null },
      );
      this.emit();
      return;
    }
    const delay = backoffDelay(
      this.restartCount,
      settings.reconnectBaseDelayMs,
      settings.reconnectMaxDelayMs,
    );
    this.backoffUntil = Date.now() + delay;
    this.state = 'restarting';
    logStore.push(
      'warn',
      'ffmpeg',
      `Restarting mosaic "/${this.plan?.slug}" in ${Math.round(delay / 1000)}s (attempt ${this.restartCount}/${settings.maxRestartAttempts}).`,
      { mosaicId: this.mosaicId, slug: this.plan?.slug ?? null },
    );
    this.emit();
    this.restartTimer = setTimeout(() => void this.launch(), delay);
  }

  async refreshResourceMetrics(): Promise<void> {
    if (!this.proc?.pid) return;
    try {
      const stat = await pidusage(this.proc.pid);
      this.metrics.cpuPercent = Math.round(stat.cpu * 10) / 10;
      this.metrics.memoryMb = Math.round((stat.memory / (1024 * 1024)) * 10) / 10;
    } catch {
      /* process may have just exited */
    }
  }

  private health(): HealthLevel {
    switch (this.state) {
      case 'running':
        return 'running';
      case 'degraded':
      case 'starting':
      case 'restarting':
        return 'warning';
      case 'failed':
        return 'offline';
      default:
        return 'unknown';
    }
  }

  getStatus(): MosaicStatus {
    const tiles: MosaicTileStatus[] =
      this.plan?.tiles.map((t) => {
        if (t.cameraId && this.suspectCameraIds.has(t.cameraId) && t.render === 'live') {
          return { ...t, render: 'placeholder' };
        }
        return t;
      }) ?? [];
    return {
      mosaicId: this.mosaicId,
      slug: this.plan?.slug ?? '',
      state: this.state,
      health: this.health(),
      pid: this.proc?.pid ?? null,
      since: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      restartCount: this.restartCount,
      lastExitCode: this.lastExitCode,
      lastError: this.lastError,
      backoffUntil: this.backoffUntil ? new Date(this.backoffUntil).toISOString() : null,
      metrics: this.metrics,
      tiles,
      mediamtx: { pathExists: false, publishing: false, readers: 0, tracks: [] },
    };
  }

  async forceKill(): Promise<void> {
    this.clearTimers();
    this.stopRequested = true;
    if (this.proc) await this.proc.stop(3000);
    this.proc = undefined;
  }
}

export class FfmpegManager {
  private readonly runners = new Map<string, MosaicRunner>();
  private stopMetrics: (() => void) | undefined;

  private cameraProber: ((cameraIds: string[]) => void) | undefined;

  constructor(
    private readonly planFn: PlanFn,
    private readonly mediamtx: MediamtxService,
  ) {}

  /** Wired by bootstrap: force a camera health re-check (used after a crash). */
  setCameraProber(fn: (cameraIds: string[]) => void): void {
    this.cameraProber = fn;
  }

  private getRunner(mosaicId: string): MosaicRunner {
    let r = this.runners.get(mosaicId);
    if (!r) {
      r = new MosaicRunner(mosaicId, this.planFn, this.mediamtx, (ids) => this.cameraProber?.(ids));
      this.runners.set(mosaicId, r);
    }
    return r;
  }

  async start(mosaicId: string): Promise<void> {
    const env = loadEnv();
    const runningExcludingThis = [...this.runners.values()].filter(
      (r) => r.mosaicId !== mosaicId && r.running,
    ).length;
    if (runningExcludingThis >= env.MAX_CONCURRENT_MOSAICS) {
      throw new Error(
        `Refusing to start: ${env.MAX_CONCURRENT_MOSAICS} mosaics are already running (MAX_CONCURRENT_MOSAICS).`,
      );
    }
    await this.getRunner(mosaicId).requestStart();
  }

  async stop(mosaicId: string): Promise<void> {
    const r = this.runners.get(mosaicId);
    if (r) await r.requestStop();
  }

  async restart(mosaicId: string): Promise<void> {
    await this.getRunner(mosaicId).requestRestart();
  }

  async remove(mosaicId: string): Promise<void> {
    const r = this.runners.get(mosaicId);
    if (r) {
      await r.requestStop();
      this.runners.delete(mosaicId);
    }
  }

  isRunning(mosaicId: string): boolean {
    return this.runners.get(mosaicId)?.running ?? false;
  }

  getStatus(mosaicId: string): MosaicStatus | null {
    return this.runners.get(mosaicId)?.getStatus() ?? null;
  }

  listStatuses(): MosaicStatus[] {
    return [...this.runners.values()].map((r) => r.getStatus());
  }

  runningCount(): number {
    return [...this.runners.values()].filter((r) => r.running).length;
  }

  ffmpegPids(): number[] {
    return [...this.runners.values()]
      .map((r) => r.pid)
      .filter((p): p is number => typeof p === 'number');
  }

  camerasInUse(): Set<string> {
    const set = new Set<string>();
    for (const r of this.runners.values()) {
      if (r.running) for (const id of r.referencedCameraIds) set.add(id);
    }
    return set;
  }

  mosaicsUsingCamera(cameraId: string): string[] {
    const out: string[] = [];
    for (const r of this.runners.values()) {
      if (r.running && r.referencedCameraIds.includes(cameraId)) out.push(r.mosaicId);
    }
    return out;
  }

  notifyCameraRecovered(cameraId: string): void {
    for (const r of this.runners.values()) r.notifyCameraRecovered(cameraId);
  }

  startMetricsLoop(intervalMs: number): void {
    this.stopMetrics = pollLoop(
      async () => {
        await Promise.all(
          [...this.runners.values()]
            .filter((r) => r.running)
            .map(async (r) => {
              await r.refreshResourceMetrics();
              bus.emit('mosaic.status', r.getStatus());
            }),
        );
      },
      intervalMs,
      { immediate: false },
    );
  }

  /** Graceful shutdown: terminate every child FFmpeg. Never leaves orphans. */
  async shutdown(): Promise<void> {
    this.stopMetrics?.();
    await Promise.all([...this.runners.values()].map((r) => r.forceKill()));
    logStore.push('info', 'ffmpeg', 'All FFmpeg processes terminated.');
  }
}

/** Re-export for test helpers. */
export { MosaicRunner, sleep };
