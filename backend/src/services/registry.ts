/**
 * Tiny late-binding registry for singletons that need constructor wiring
 * (breaking would-be import cycles between services / routes).
 * Populated once by bootstrap.ts during startup.
 */
import type { FfmpegManager } from './ffmpeg-manager.js';
import type { StatusHub } from './status-hub.js';
import type { Reconciler } from './reconciler.js';

interface Registry {
  ffmpegManager?: FfmpegManager;
  statusHub?: StatusHub;
  reconciler?: Reconciler;
}

const registry: Registry = {};

export function setFfmpegManager(m: FfmpegManager): void {
  registry.ffmpegManager = m;
}
export function getFfmpegManager(): FfmpegManager {
  if (!registry.ffmpegManager) throw new Error('FfmpegManager not initialised yet');
  return registry.ffmpegManager;
}

export function setStatusHub(h: StatusHub): void {
  registry.statusHub = h;
}
export function getStatusHub(): StatusHub {
  if (!registry.statusHub) throw new Error('StatusHub not initialised yet');
  return registry.statusHub;
}

export function setReconciler(r: Reconciler): void {
  registry.reconciler = r;
}
export function getReconciler(): Reconciler {
  if (!registry.reconciler) throw new Error('Reconciler not initialised yet');
  return registry.reconciler;
}

/** Optional accessors for early-boot code paths. */
export function tryGetFfmpegManager(): FfmpegManager | undefined {
  return registry.ffmpegManager;
}
