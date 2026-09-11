import { loadEnv } from '../config/env.js';
import { getLogger } from '../config/logger.js';
import { getDb, runMigrations, closeDb } from '../db/index.js';
import { getSettings, saveSettings } from '../db/repo/settings.js';
import { logStore } from '../lib/log-store.js';
import { FfmpegManager } from './ffmpeg-manager.js';
import { getMediamtxService } from './mediamtx-service.js';
import { getCameraMonitor } from './camera-monitor.js';
import { getStatusHubInstance } from './status-hub.js';
import { Reconciler } from './reconciler.js';
import { planBuild } from './mosaic-service.js';
import { detectCapabilities } from './ffmpeg-capabilities.js';
import { setFfmpegManager, setStatusHub, setReconciler } from './registry.js';

export interface RuntimeHandles {
  shutdown: () => Promise<void>;
}

/**
 * Constructs and wires every long-lived service. Poll loops and the startup
 * reconciliation run in the background so `server.listen()` is never blocked
 * (spec §20 — tolerate MediaMTX starting after the app).
 */
export async function bootstrap(): Promise<RuntimeHandles> {
  const env = loadEnv();
  const log = getLogger();

  // 1. Database.
  getDb();
  runMigrations();
  // Ensure a settings row exists.
  saveSettings(getSettings());

  // 2. Core services.
  const mediamtx = getMediamtxService();
  const manager = new FfmpegManager(planBuild, mediamtx);
  const statusHub = getStatusHubInstance();
  const reconciler = new Reconciler(mediamtx, manager);
  const monitor = getCameraMonitor();

  setFfmpegManager(manager);
  setStatusHub(statusHub);
  setReconciler(reconciler);

  // 3. Cross-wiring.
  monitor.setUsageProvider((cameraId) => manager.mosaicsUsingCamera(cameraId));
  monitor.onRecovered((cameraId) => manager.notifyCameraRecovered(cameraId));
  manager.setCameraProber((cameraIds) => {
    for (const id of cameraIds) void monitor.probeCamera(id);
  });

  // 4. Background loops.
  mediamtx.startPolling(env.MEDIAMTX_POLL_MS);
  manager.startMetricsLoop(env.METRICS_POLL_MS);
  statusHub.start(env.METRICS_POLL_MS);
  monitor.start(env.CAMERA_MONITOR_MS);

  // 5. Capability scan (non-blocking).
  void detectCapabilities().catch((err) =>
    logStore.push('warn', 'app', `Encoder capability scan failed: ${(err as Error).message}`),
  );

  // 6. Startup reconciliation + auto-start (non-blocking).
  void reconciler.runStartup().catch((err) =>
    logStore.push('error', 'app', `Startup reconciliation error: ${(err as Error).message}`),
  );

  log.info('bootstrap complete');
  logStore.push('info', 'app', 'Backend started.');

  return {
    async shutdown() {
      logStore.push('info', 'app', 'Shutting down…');
      monitor.stop();
      statusHub.shutdown();
      mediamtx.stop();
      await manager.shutdown();
      closeDb();
    },
  };
}
