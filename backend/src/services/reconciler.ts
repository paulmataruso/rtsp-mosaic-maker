import { sleep } from '../lib/async.js';
import { logStore } from '../lib/log-store.js';
import { getMediamtxService, type MediamtxService } from './mediamtx-service.js';
import type { FfmpegManager } from './ffmpeg-manager.js';
import { desiredManagedPaths, autoStartMosaicIds } from './mosaic-service.js';
import { listMosaicRows } from '../db/repo/mosaics.js';

/**
 * Keeps the running system aligned with the database (the desired state):
 *  - on boot: wait for MediaMTX, reconcile paths, start auto-start mosaics
 *  - on a detected MediaMTX restart: re-create managed paths; the FFmpeg
 *    supervisor then re-publishes on its next cycle
 * (spec §33 — self-healing).
 */
export class Reconciler {
  private reconciling = false;
  private pending = false;

  constructor(
    private readonly mediamtx: MediamtxService,
    private readonly manager: FfmpegManager,
  ) {
    this.mediamtx.onServerRestart(() => void this.reconcileNow('MediaMTX restart'));
  }

  async runStartup(): Promise<void> {
    logStore.push('info', 'app', 'Startup reconciliation beginning…');
    try {
      await this.mediamtx.waitUntilReady(120_000);
    } catch (err) {
      logStore.push(
        'error',
        'app',
        `MediaMTX did not become ready: ${(err as Error).message}. The app will keep retrying in the background.`,
      );
    }

    await this.mediamtx.reconcile(desiredManagedPaths()).catch((err) =>
      logStore.push('error', 'app', `Path reconciliation failed: ${(err as Error).message}`),
    );

    const autos = autoStartMosaicIds();
    if (autos.length > 0) {
      logStore.push('info', 'app', `Auto-starting ${autos.length} mosaic(s).`);
    }
    for (const id of autos) {
      try {
        await this.manager.start(id);
      } catch (err) {
        logStore.push('error', 'app', `Auto-start failed for a mosaic: ${(err as Error).message}`, {
          mosaicId: id,
        });
      }
      await sleep(1500); // stagger so cameras/CPU aren't hammered at once
    }
    logStore.push('info', 'app', 'Startup reconciliation complete.');
  }

  async reconcileNow(trigger: string): Promise<void> {
    if (this.reconciling) {
      this.pending = true;
      return;
    }
    this.reconciling = true;
    try {
      logStore.push('info', 'app', `Reconciling MediaMTX (${trigger})…`);
      await this.mediamtx.reconcile(desiredManagedPaths());
      // Re-assert paths for anything currently supervised.
      const bySlug = new Map(listMosaicRows().map((m) => [m.id, m.slug]));
      for (const status of this.manager.listStatuses()) {
        if (!['running', 'degraded', 'starting', 'restarting'].includes(status.state)) continue;
        const slug = bySlug.get(status.mosaicId);
        if (slug) await this.mediamtx.ensurePath(slug, status.mosaicId).catch(() => undefined);
      }
    } finally {
      this.reconciling = false;
      if (this.pending) {
        this.pending = false;
        void this.reconcileNow('coalesced');
      }
    }
  }
}

let singleton: Reconciler | undefined;
export function getReconcilerInstance(manager: FfmpegManager): Reconciler {
  if (!singleton) singleton = new Reconciler(getMediamtxService(), manager);
  return singleton;
}
