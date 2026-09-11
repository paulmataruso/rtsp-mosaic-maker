import {
  slugify,
  validateSlug,
  mosaicInputSchema,
  MAX_TILES_PER_MOSAIC,
  type MosaicDto,
  type MosaicInput,
  type MosaicUpdateInput,
  type MosaicCellDto,
  type MosaicTileStatus,
  type EncoderId,
} from 'shared';
import { NotFound, BadRequest, ResourceLimit, PreconditionFailed } from '../lib/errors.js';
import { loadEnv } from '../config/env.js';
import { getSettings } from '../db/repo/settings.js';
import { logStore } from '../lib/log-store.js';
import {
  listMosaicRows,
  getMosaicRow,
  getMosaicWithCells,
  getCellsForMosaic,
  insertMosaic,
  updateMosaicRow,
  deleteMosaicRow,
  slugExists,
  type MosaicWrite,
  type CellWrite,
  type MosaicWithCells,
} from '../db/repo/mosaics.js';
import { getCameraRow } from '../db/repo/cameras.js';
import { deleteManagedPath } from '../db/repo/managed-paths.js';
import { getMediamtxService } from './mediamtx-service.js';
import { getCameraMonitor } from './camera-monitor.js';
import { getFfmpegManager, tryGetFfmpegManager } from './registry.js';
import { decryptCameraPassword } from './camera-service.js';
import { buildMosaicCommand, type TileInput } from './ffmpeg-command.js';
import { cachedCapabilities } from './ffmpeg-capabilities.js';
import type { PlannedMosaic } from './ffmpeg-manager.js';

/* --------------------------- DTO mapping ---------------------------------- */

function cellToDto(c: ReturnType<typeof getCellsForMosaic>[number]): MosaicCellDto {
  return {
    id: c.id,
    mosaicId: c.mosaicId,
    position: c.position,
    cameraId: c.cameraId ?? null,
    streamType: c.streamType,
    fitMode: c.fitMode,
    label: c.label ?? null,
    labelEnabled: c.labelEnabled,
    labelPosition: c.labelPosition as MosaicCellDto['labelPosition'],
    labelFontSize: c.labelFontSize,
    labelBgOpacity: c.labelBgOpacity,
    enabled: c.enabled,
  };
}

export function toMosaicDto(mwc: MosaicWithCells): MosaicDto {
  const m = mwc.mosaic;
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    slug: m.slug,
    rows: m.rows,
    cols: m.cols,
    width: m.width,
    height: m.height,
    fps: m.fps,
    videoBitrateKbps: m.videoBitrateKbps,
    codec: m.codec,
    encoder: m.encoder as EncoderId,
    gopSeconds: m.gopSeconds,
    backgroundColor: m.backgroundColor,
    autoStart: m.autoStart,
    enabled: m.enabled,
    cells: mwc.cells.map(cellToDto),
    rtspUrl: getMediamtxService().getPublicRtspUrl(m.slug),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/* --------------------------- Validation --------------------------------- */

function ensureUniqueSlug(base: string, exceptId?: string): string {
  let candidate = base;
  let n = 2;
  while (slugExists(candidate, exceptId)) {
    candidate = `${base}-${n++}`.slice(0, 64).replace(/-+$/g, '');
  }
  const v = validateSlug(candidate);
  if (!v.ok) throw BadRequest(v.reason ?? 'Invalid slug');
  return candidate;
}

interface PreparedMosaic {
  write: MosaicWrite;
  cells: CellWrite[];
}

function prepare(input: MosaicInput, exceptId?: string): PreparedMosaic {
  const parsed = mosaicInputSchema.parse(input);
  const capacity = parsed.rows * parsed.cols;

  const requestedSlug = parsed.slug && parsed.slug.length > 0 ? parsed.slug : slugify(parsed.name);
  const slug = ensureUniqueSlug(requestedSlug, exceptId);

  const cameraCells = parsed.cells.filter((c) => c.cameraId && c.enabled);
  if (cameraCells.length > MAX_TILES_PER_MOSAIC) {
    throw ResourceLimit(`A mosaic can reference at most ${MAX_TILES_PER_MOSAIC} camera tiles.`);
  }
  for (const c of parsed.cells) {
    if (c.position >= capacity) {
      throw BadRequest(`Cell position ${c.position} does not fit a ${parsed.rows}×${parsed.cols} grid.`);
    }
    if (c.cameraId && !getCameraRow(c.cameraId)) {
      throw BadRequest(`Cell ${c.position} references a camera that does not exist.`);
    }
  }

  const write: MosaicWrite = {
    name: parsed.name.trim(),
    description: parsed.description.trim(),
    slug,
    rows: parsed.rows,
    cols: parsed.cols,
    width: parsed.width,
    height: parsed.height,
    fps: parsed.fps,
    videoBitrateKbps: parsed.videoBitrateKbps,
    codec: parsed.codec,
    encoder: parsed.encoder,
    gopSeconds: parsed.gopSeconds,
    backgroundColor: parsed.backgroundColor,
    autoStart: parsed.autoStart,
    enabled: parsed.enabled,
  };

  const cells: CellWrite[] = parsed.cells.map((c) => ({
    position: c.position,
    cameraId: c.cameraId ?? null,
    streamType: c.streamType,
    fitMode: c.fitMode,
    label: c.label ?? null,
    labelEnabled: c.labelEnabled,
    labelPosition: c.labelPosition,
    labelFontSize: c.labelFontSize,
    labelBgOpacity: c.labelBgOpacity,
    enabled: c.enabled,
  }));

  return { write, cells };
}

/* --------------------------- CRUD ------------------------------------- */

export function listMosaics(): MosaicDto[] {
  return listMosaicRows().map((m) => toMosaicDto({ mosaic: m, cells: getCellsForMosaic(m.id) }));
}

export function getMosaic(id: string): MosaicDto {
  const mwc = getMosaicWithCells(id);
  if (!mwc) throw NotFound('Mosaic', id);
  return toMosaicDto(mwc);
}

export function createMosaic(input: MosaicInput): MosaicDto {
  const { write, cells } = prepare(input);
  const mwc = insertMosaic(write, cells);
  logStore.push('info', 'app', `Mosaic "${write.name}" created (/${write.slug}).`, {
    mosaicId: mwc.mosaic.id,
    slug: write.slug,
  });
  // Pre-create the MediaMTX path so the URL is live immediately.
  void getMediamtxService()
    .ensurePath(write.slug, mwc.mosaic.id)
    .catch((err) => logStore.push('warn', 'mediamtx', `Could not pre-create path: ${err.message}`));
  return toMosaicDto(mwc);
}

export async function updateMosaic(id: string, patch: MosaicUpdateInput): Promise<MosaicDto> {
  const existing = getMosaicWithCells(id);
  if (!existing) throw NotFound('Mosaic', id);

  // Merge patch over current values, then re-run full validation.
  const merged: MosaicInput = {
    name: patch.name ?? existing.mosaic.name,
    description: patch.description ?? existing.mosaic.description,
    slug: patch.slug ?? existing.mosaic.slug,
    rows: patch.rows ?? existing.mosaic.rows,
    cols: patch.cols ?? existing.mosaic.cols,
    width: patch.width ?? existing.mosaic.width,
    height: patch.height ?? existing.mosaic.height,
    fps: patch.fps ?? existing.mosaic.fps,
    videoBitrateKbps: patch.videoBitrateKbps ?? existing.mosaic.videoBitrateKbps,
    codec: patch.codec ?? existing.mosaic.codec,
    encoder: (patch.encoder ?? existing.mosaic.encoder) as EncoderId,
    gopSeconds: patch.gopSeconds ?? existing.mosaic.gopSeconds,
    backgroundColor: patch.backgroundColor ?? existing.mosaic.backgroundColor,
    autoStart: patch.autoStart ?? existing.mosaic.autoStart,
    enabled: patch.enabled ?? existing.mosaic.enabled,
    cells:
      patch.cells ??
      existing.cells.map((c) => ({
        position: c.position,
        cameraId: c.cameraId ?? null,
        streamType: c.streamType,
        fitMode: c.fitMode,
        label: c.label ?? null,
        labelEnabled: c.labelEnabled,
        labelPosition: c.labelPosition as MosaicCellDto['labelPosition'],
        labelFontSize: c.labelFontSize,
        labelBgOpacity: c.labelBgOpacity,
        enabled: c.enabled,
      })),
  };

  const { write, cells } = prepare(merged, id);
  const oldSlug = existing.mosaic.slug;

  const mwc = updateMosaicRow(id, write, cells);
  if (!mwc) throw NotFound('Mosaic', id);

  const manager = tryGetFfmpegManager();
  const mediamtx = getMediamtxService();

  if (oldSlug !== write.slug) {
    logStore.push('info', 'app', `Mosaic slug changed: /${oldSlug} -> /${write.slug}.`, {
      mosaicId: id,
    });
    await mediamtx.removePath(oldSlug).catch(() => undefined);
    await mediamtx.ensurePath(write.slug, id).catch(() => undefined);
  }

  if (manager?.isRunning(id)) {
    logStore.push('info', 'app', 'Applying mosaic changes — restarting FFmpeg.', {
      mosaicId: id,
      slug: write.slug,
    });
    await manager.restart(id);
  }

  return toMosaicDto(mwc);
}

/** Full teardown per spec §19: stop FFmpeg, drop the path, delete config, verify. */
export async function deleteMosaic(id: string): Promise<void> {
  const mwc = getMosaicWithCells(id);
  if (!mwc) throw NotFound('Mosaic', id);
  const slug = mwc.mosaic.slug;

  const manager = getFfmpegManager();
  await manager.remove(id);
  if (manager.isRunning(id)) {
    throw PreconditionFailed('FFmpeg process did not stop; aborting delete. Try again.');
  }

  await getMediamtxService().removePath(slug).catch((err) => {
    logStore.push('warn', 'mediamtx', `Path removal during delete failed: ${err.message}`, { slug });
  });

  deleteManagedPath(slug);
  if (!deleteMosaicRow(id)) throw NotFound('Mosaic', id);

  logStore.push('info', 'app', `Mosaic "${mwc.mosaic.name}" deleted; path /${slug} removed.`, {
    mosaicId: id,
    slug,
  });
}

/* --------------------------- Lifecycle --------------------------------- */

function assertEncoderAvailable(encoder: EncoderId): void {
  if (encoder === 'libx264') return;
  const caps = cachedCapabilities();
  if (!caps) return; // not scanned yet — let FFmpeg be the judge
  const cap = caps.encoders.find((e) => e.id === encoder);
  if (cap && !cap.available) {
    throw PreconditionFailed(
      `Encoder "${encoder}" is not available on this host: ${cap.detail} ` +
        `Pick "CPU — libx264" or fix the GPU setup (see docs/GPU.md).`,
    );
  }
}

export async function startMosaic(id: string): Promise<void> {
  const mwc = getMosaicWithCells(id);
  if (!mwc) throw NotFound('Mosaic', id);
  if (!mwc.mosaic.enabled) throw PreconditionFailed('This mosaic is disabled. Enable it first.');

  const cameraCells = mwc.cells.filter((c) => c.enabled && c.cameraId);
  if (cameraCells.length === 0) {
    throw PreconditionFailed('Add at least one camera to the grid before starting.');
  }
  assertEncoderAvailable(mwc.mosaic.encoder as EncoderId);

  const env = loadEnv();
  const manager = getFfmpegManager();
  const projectedTiles =
    manager
      .listStatuses()
      .filter((s) => s.mosaicId !== id && ['running', 'degraded', 'starting', 'restarting'].includes(s.state))
      .reduce((sum, s) => sum + s.tiles.filter((t) => t.render !== 'empty').length, 0) +
    cameraCells.length;
  if (projectedTiles > env.MAX_TOTAL_TILES) {
    throw ResourceLimit(
      `Starting this mosaic would bring the total live tile count to ${projectedTiles}, over the MAX_TOTAL_TILES limit of ${env.MAX_TOTAL_TILES}.`,
    );
  }

  await manager.start(id);
}

export async function stopMosaic(id: string): Promise<void> {
  if (!getMosaicRow(id)) throw NotFound('Mosaic', id);
  await getFfmpegManager().stop(id);
}

export async function restartMosaic(id: string): Promise<void> {
  if (!getMosaicRow(id)) throw NotFound('Mosaic', id);
  await getFfmpegManager().restart(id);
}

/* --------------------------- Planner (planFn) ------------------------- */

/**
 * Turns the stored mosaic + live camera health into a concrete FFmpeg command.
 * Cameras that are known-down or flagged as "suspect" by the manager are
 * rendered as OFFLINE placeholder tiles instead of RTSP inputs, so a single
 * dead camera never brings the mosaic down.
 */
export async function planBuild(
  mosaicId: string,
  ctx: { suspectCameraIds: Set<string> },
): Promise<PlannedMosaic> {
  const mwc = getMosaicWithCells(mosaicId);
  if (!mwc) throw NotFound('Mosaic', mosaicId);
  const m = mwc.mosaic;
  const env = loadEnv();
  const settings = getSettings();
  const monitor = getCameraMonitor();

  const tiles: TileInput[] = [];
  const statusTiles: MosaicTileStatus[] = [];
  const positionCameraId: Record<number, string> = {};
  const referenced = new Set<string>();

  for (const cell of mwc.cells) {
    if (!cell.enabled || !cell.cameraId) {
      statusTiles.push({
        position: cell.position,
        cameraId: cell.cameraId ?? null,
        cameraName: null,
        streamType: cell.streamType,
        render: 'empty',
      });
      continue;
    }
    const cam = getCameraRow(cell.cameraId);
    if (!cam) {
      statusTiles.push({
        position: cell.position,
        cameraId: cell.cameraId,
        cameraName: null,
        streamType: cell.streamType,
        render: 'empty',
      });
      continue;
    }
    referenced.add(cam.id);
    positionCameraId[cell.position] = cam.id;

    const labelText = cell.label ?? cam.name;
    const label = cell.labelEnabled
      ? {
          text: labelText,
          position: cell.labelPosition as
            | 'top-left'
            | 'top-center'
            | 'top-right'
            | 'bottom-left'
            | 'bottom-center'
            | 'bottom-right',
          fontSize: cell.labelFontSize,
          bgOpacity: cell.labelBgOpacity,
        }
      : null;

    const forcedPlaceholder =
      !cam.enabled || ctx.suspectCameraIds.has(cam.id) || monitor.isKnownDown(cam.id);

    if (forcedPlaceholder) {
      tiles.push({
        kind: 'placeholder',
        position: cell.position,
        text: `${cam.name} — OFFLINE`,
        label,
      });
      statusTiles.push({
        position: cell.position,
        cameraId: cam.id,
        cameraName: cam.name,
        streamType: cell.streamType,
        render: 'placeholder',
      });
      continue;
    }

    const url =
      cell.streamType === 'sub' && cam.subRtspUrl ? cam.subRtspUrl : cam.mainRtspUrl;
    tiles.push({
      kind: 'camera',
      position: cell.position,
      rtspUrl: url,
      username: cam.username || null,
      password: decryptCameraPassword(cam) || null,
      transport: cam.transport,
      streamType: cell.streamType,
      fitMode: cell.fitMode,
      label,
    });
    statusTiles.push({
      position: cell.position,
      cameraId: cam.id,
      cameraName: cam.name,
      streamType: cell.streamType,
      render: 'live',
    });
  }

  const build = buildMosaicCommand({
    grid: { rows: m.rows, cols: m.cols },
    output: {
      width: m.width,
      height: m.height,
      fps: m.fps,
      videoBitrateKbps: m.videoBitrateKbps,
      gopSeconds: m.gopSeconds,
      backgroundColor: m.backgroundColor,
    },
    encoder: m.encoder as EncoderId,
    tiles,
    publish: {
      rtspBaseUrl: env.MEDIAMTX_RTSP_URL,
      slug: m.slug,
      username: env.MEDIAMTX_PUBLISH_USER || undefined,
      password: env.MEDIAMTX_PUBLISH_PASS || undefined,
      transport: 'tcp',
    },
    resilience: { rtspTimeoutMs: settings.rtspConnectTimeoutMs },
    ffmpeg: {
      binary: env.FFMPEG_PATH,
      logLevel: env.FFMPEG_LOG_LEVEL,
      fontFile: env.FFMPEG_FONT_FILE,
    },
    hw: {
      vaapiDevice: '/dev/dri/renderD128',
    },
  });

  return {
    mosaicId,
    slug: m.slug,
    build,
    encoderId: m.encoder as EncoderId,
    expectedFps: m.fps,
    expectedWidth: m.width,
    expectedHeight: m.height,
    expectedBitrateKbps: m.videoBitrateKbps,
    tiles: statusTiles,
    positionCameraId,
    referencedCameraIds: [...referenced],
  };
}

/** Slugs the DB currently wants MediaMTX to expose (for reconciliation). */
export function desiredManagedPaths(): Array<{ slug: string; mosaicId: string }> {
  return listMosaicRows().map((m) => ({ slug: m.slug, mosaicId: m.id }));
}

/** Mosaics flagged to auto-start. */
export function autoStartMosaicIds(): string[] {
  return listMosaicRows()
    .filter((m) => m.enabled && m.autoStart)
    .map((m) => m.id);
}
