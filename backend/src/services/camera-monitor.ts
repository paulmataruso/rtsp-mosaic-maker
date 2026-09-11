import { pollLoop } from '../lib/async.js';
import { bus } from '../lib/event-bus.js';
import { logStore } from '../lib/log-store.js';
import { listCameraRows, getCameraRow } from '../db/repo/cameras.js';
import { decryptSecret } from '../lib/crypto.js';
import { testCameraConnection } from './camera-tester.js';
import type { CameraRow } from '../db/schema.js';
import type { CameraStatus, HealthLevel } from 'shared';

interface MonitorEntry {
  status: CameraStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

/**
 * Periodically probes every enabled camera and keeps a live health map.
 * The FfmpegManager consults `isHealthy()` when (re)building a mosaic so a
 * down camera is rendered as an OFFLINE placeholder instead of failing the
 * whole process, and `onRecovered` lets it restore a tile when the camera
 * comes back.
 */
export class CameraMonitor {
  private readonly entries = new Map<string, MonitorEntry>();
  private stopFn: (() => void) | undefined;
  private usageProvider: (cameraId: string) => string[] = () => [];
  private recoveredCb: ((cameraId: string) => void) | undefined;
  private inFlight = new Set<string>();

  setUsageProvider(fn: (cameraId: string) => string[]): void {
    this.usageProvider = fn;
  }

  onRecovered(cb: (cameraId: string) => void): void {
    this.recoveredCb = cb;
  }

  private blank(cameraId: string, enabled: boolean): CameraStatus {
    return {
      cameraId,
      health: 'unknown',
      enabled,
      lastCheckedAt: null,
      rtspConnected: false,
      width: null,
      height: null,
      codec: null,
      fps: null,
      lastFrameAt: null,
      lastError: null,
      usedByRunningMosaics: this.usageProvider(cameraId),
    };
  }

  getStatus(cameraId: string): CameraStatus {
    return this.entries.get(cameraId)?.status ?? this.blank(cameraId, true);
  }

  getAll(): CameraStatus[] {
    return [...this.entries.values()].map((e) => ({
      ...e.status,
      usedByRunningMosaics: this.usageProvider(e.status.cameraId),
    }));
  }

  isHealthy(cameraId: string): boolean {
    const e = this.entries.get(cameraId);
    return e ? e.status.health === 'running' : false;
  }

  /** Known state without a probe (for callers that only need best-effort). */
  isKnownDown(cameraId: string): boolean {
    const e = this.entries.get(cameraId);
    return !!e && (e.status.health === 'offline');
  }

  async probeCamera(cameraId: string): Promise<CameraStatus> {
    if (this.inFlight.has(cameraId)) return this.getStatus(cameraId);
    this.inFlight.add(cameraId);
    try {
      const row = getCameraRow(cameraId);
      if (!row) {
        this.entries.delete(cameraId);
        return this.blank(cameraId, false);
      }
      return await this.runProbe(row);
    } finally {
      this.inFlight.delete(cameraId);
    }
  }

  private async runProbe(row: CameraRow): Promise<CameraStatus> {
    const prev = this.entries.get(row.id) ?? {
      status: this.blank(row.id, row.enabled),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
    };

    if (!row.enabled) {
      const status: CameraStatus = {
        ...this.blank(row.id, false),
        health: 'unknown',
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      };
      this.entries.set(row.id, { status, consecutiveFailures: 0, consecutiveSuccesses: 0 });
      this.emitIfChanged(prev.status, status);
      return status;
    }

    const password = row.encryptedPassword ? safeDecrypt(row.encryptedPassword) : '';
    const streamType = row.subRtspUrl ? 'sub' : 'main';
    const result = await testCameraConnection(
      {
        host: row.host,
        mainRtspUrl: row.mainRtspUrl,
        subRtspUrl: row.subRtspUrl,
        username: row.username,
        password,
        transport: row.transport,
      },
      streamType,
    ).catch((err) => ({ ok: false, err }) as const);

    const now = new Date().toISOString();
    let entry: MonitorEntry;

    if ('err' in result || !result.ok) {
      const failures = prev.consecutiveFailures + 1;
      const health: HealthLevel = failures >= 2 ? 'offline' : 'warning';
      const lastError =
        'err' in result
          ? (result.err as Error).message
          : ('summary' in result ? result.summary : 'probe failed');
      entry = {
        status: {
          ...prev.status,
          cameraId: row.id,
          enabled: true,
          health,
          lastCheckedAt: now,
          rtspConnected: false,
          lastError,
          usedByRunningMosaics: this.usageProvider(row.id),
        },
        consecutiveFailures: failures,
        consecutiveSuccesses: 0,
      };
    } else {
      const successes = prev.consecutiveSuccesses + 1;
      entry = {
        status: {
          cameraId: row.id,
          enabled: true,
          health: 'running',
          lastCheckedAt: now,
          rtspConnected: true,
          width: result.stream?.width ?? null,
          height: result.stream?.height ?? null,
          codec: result.stream?.codec ?? null,
          fps: result.stream?.fps ?? null,
          lastFrameAt: now,
          lastError: null,
          usedByRunningMosaics: this.usageProvider(row.id),
        },
        consecutiveFailures: 0,
        consecutiveSuccesses: successes,
      };
      // Recovered from a down state -> let the manager restore the tile.
      if (prev.status.health !== 'running' && prev.consecutiveFailures > 0) {
        logStore.push('info', 'camera', `Camera "${row.name}" recovered.`, { cameraId: row.id });
        this.recoveredCb?.(row.id);
      }
    }

    this.entries.set(row.id, entry);
    this.emitIfChanged(prev.status, entry.status);
    return entry.status;
  }

  private emitIfChanged(before: CameraStatus, after: CameraStatus): void {
    if (
      before.health !== after.health ||
      before.rtspConnected !== after.rtspConnected ||
      before.codec !== after.codec ||
      before.width !== after.width
    ) {
      if (before.health !== after.health && after.health === 'offline') {
        logStore.push('warn', 'camera', `Camera went offline: ${after.lastError ?? 'unreachable'}`, {
          cameraId: after.cameraId,
        });
      }
    }
    bus.emit('camera.status', after);
  }

  private async sweep(): Promise<void> {
    const rows = listCameraRows();
    // Drop entries for deleted cameras.
    const ids = new Set(rows.map((r) => r.id));
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);

    // Probe with limited concurrency.
    const queue = [...rows];
    const workers = Array.from({ length: 4 }, async () => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        await this.runProbe(row).catch(() => undefined);
      }
    });
    await Promise.all(workers);
  }

  start(intervalMs: number): void {
    this.stopFn = pollLoop(() => this.sweep(), intervalMs, {
      immediate: true,
      onError: (err) =>
        logStore.push('error', 'camera', `Monitor sweep failed: ${(err as Error).message}`),
    });
  }

  stop(): void {
    this.stopFn?.();
  }
}

function safeDecrypt(blob: string): string {
  try {
    return decryptSecret(blob);
  } catch {
    return '';
  }
}

let singleton: CameraMonitor | undefined;
export function getCameraMonitor(): CameraMonitor {
  if (!singleton) singleton = new CameraMonitor();
  return singleton;
}
