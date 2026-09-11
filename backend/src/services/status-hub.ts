import { bus } from '../lib/event-bus.js';
import { pollLoop } from '../lib/async.js';
import { listMosaicRows } from '../db/repo/mosaics.js';
import { listCameraRows } from '../db/repo/cameras.js';
import { getFfmpegManager } from './registry.js';
import { getMediamtxService } from './mediamtx-service.js';
import { getCameraMonitor } from './camera-monitor.js';
import { sampleCpuPercent, memoryMb, loadAvg1, cpuCount } from '../lib/host-metrics.js';
import type { MosaicStatus, DashboardSummary } from 'shared';

/**
 * Read model. Composes the FFmpeg process status (from FfmpegManager) with the
 * MediaMTX runtime path state (from MediamtxService) and host metrics into the
 * shapes the REST API and dashboard need. WebSocket clients receive the raw
 * component events and merge them the same way client-side.
 */
export class StatusHub {
  private lastHostCpu: number | null = null;
  private lastHostMem: { usedMb: number; totalMb: number } = { usedMb: 0, totalMb: 0 };
  private stop: (() => void) | undefined;

  composeMosaic(status: MosaicStatus): MosaicStatus {
    const mtx = getMediamtxService().getSnapshot();
    const path = mtx?.paths.find((p) => p.name === status.slug);
    return {
      ...status,
      mediamtx: {
        pathExists: !!path || (mtx?.reachable ? false : status.mediamtx.pathExists),
        publishing: !!path && path.ready && (path.source === 'publisher' || path.source === 'rtspSession' || path.source === 'rtspsSession'),
        readers: path?.readers ?? 0,
        tracks: path?.tracks ?? [],
      },
    };
  }

  getMosaicStatus(mosaicId: string): MosaicStatus | null {
    const raw = getFfmpegManager().getStatus(mosaicId);
    return raw ? this.composeMosaic(raw) : null;
  }

  listMosaicStatuses(): MosaicStatus[] {
    return getFfmpegManager()
      .listStatuses()
      .map((s) => this.composeMosaic(s));
  }

  async buildDashboard(): Promise<DashboardSummary> {
    const manager = getFfmpegManager();
    const monitor = getCameraMonitor();
    const mtx = getMediamtxService().getSnapshot();

    const cameras = listCameraRows();
    const enabledCameras = cameras.filter((c) => c.enabled);
    const camerasOnline = enabledCameras.filter(
      (c) => monitor.getStatus(c.id).health === 'running',
    ).length;

    const mosaics = listMosaicRows();
    const statuses = manager.listStatuses();
    const mosaicsRunning = statuses.filter((s) =>
      ['running', 'degraded'].includes(s.state),
    ).length;

    return {
      camerasOnline,
      camerasTotal: enabledCameras.length,
      mosaicsRunning,
      mosaicsTotal: mosaics.length,
      ffmpegProcesses: manager.ffmpegPids().length,
      mediamtx: mtx?.reachable ? 'online' : 'offline',
      host: {
        cpuPercent: this.lastHostCpu,
        loadAvg1: loadAvg1(),
        memUsedMb: this.lastHostMem.usedMb,
        memTotalMb: this.lastHostMem.totalMb,
        cpuCount: cpuCount(),
      },
    };
  }

  observedProcessLoad(): { cpuPercent: number | null; memoryMb: number | null; tiles: number } {
    const statuses = getFfmpegManager().listStatuses();
    let cpu = 0;
    let mem = 0;
    let haveCpu = false;
    let tiles = 0;
    for (const s of statuses) {
      if (!['running', 'degraded', 'starting', 'restarting'].includes(s.state)) continue;
      tiles += s.tiles.filter((t) => t.render !== 'empty').length;
      if (s.metrics.cpuPercent !== null) {
        cpu += s.metrics.cpuPercent;
        haveCpu = true;
      }
      if (s.metrics.memoryMb !== null) mem += s.metrics.memoryMb;
    }
    return {
      cpuPercent: haveCpu ? Math.round(cpu) : null,
      memoryMb: mem > 0 ? Math.round(mem) : null,
      tiles,
    };
  }

  start(intervalMs: number): void {
    this.stop = pollLoop(
      async () => {
        this.lastHostCpu = (await sampleCpuPercent()) ?? this.lastHostCpu;
        this.lastHostMem = await memoryMb();
        bus.emit('dashboard', await this.buildDashboard());
      },
      intervalMs,
      { immediate: true },
    );

    // Nudge the dashboard on significant component changes too.
    bus.on('mediamtx.status', () => {
      void this.buildDashboard().then((d) => bus.emit('dashboard', d));
    });
  }

  shutdown(): void {
    this.stop?.();
  }
}

let singleton: StatusHub | undefined;
export function getStatusHubInstance(): StatusHub {
  if (!singleton) singleton = new StatusHub();
  return singleton;
}
