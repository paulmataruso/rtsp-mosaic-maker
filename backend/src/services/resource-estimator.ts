import os from 'node:os';
import type { ResourceEstimate, ResourceEstimateRequest, EncoderId } from 'shared';

/**
 * Deliberately-approximate resource model. It exists to stop an operator from
 * casually spinning up 16×1080p on a 4-core box, not to predict load to the
 * percent. Observed metrics from running processes are surfaced alongside so
 * the estimate can be sanity-checked against reality.
 *
 * Constants are cores needed to sustain 1 gigapixel/second of throughput,
 * calibrated loosely against x86 mini-PC measurements. See docs/FFMPEG.md.
 */
const DECODE_CORES_PER_GPXPS = 16;
const COMPOSITE_CORES_PER_GPXPS = 13;
const ENCODE_CORES_PER_GPXPS: Record<EncoderId, number> = {
  libx264: 18,
  h264_vaapi: 1.2,
  h264_qsv: 1.0,
  h264_nvenc: 0.8,
};

/** Assumed source characteristics when the real ones aren't known yet. */
const ASSUMED_SUB = { w: 640, h: 360, fps: 15 };
const ASSUMED_MAIN = { w: 1920, h: 1080, fps: 15 };

export interface EstimateContext {
  cpuCount: number;
  current: {
    runningMosaics: number;
    totalTiles: number;
    observedCpuPercent: number | null;
    observedMemoryMb: number | null;
  };
}

export function estimateResources(
  req: ResourceEstimateRequest,
  ctx: EstimateContext,
): ResourceEstimate {
  const outFps = req.fps;
  const outGpxps = (req.width * req.height * outFps) / 1e9;
  const notes: string[] = [];

  let decodeGpxps = 0;
  for (const tile of req.tiles) {
    const assumed = tile.streamType === 'sub' ? ASSUMED_SUB : ASSUMED_MAIN;
    const w = tile.sourceWidth ?? assumed.w;
    const h = tile.sourceHeight ?? assumed.h;
    // Cameras usually deliver ~15 fps on substreams; decode cost tracks source fps.
    const srcFps = assumed.fps;
    decodeGpxps += (w * h * srcFps) / 1e9;
  }

  // Compositing cost grows with tile count (one scale + pad + drawtext each)
  // plus the xstack pass over the whole output frame.
  const compositeGpxps = outGpxps * (0.7 + 0.2 * req.tiles.length);
  const encodeCoresPerGpxps: number = ENCODE_CORES_PER_GPXPS[req.encoder] ?? 18;

  const decodeLoad = decodeGpxps * DECODE_CORES_PER_GPXPS;
  const compositeLoad = compositeGpxps * COMPOSITE_CORES_PER_GPXPS;
  const encodeLoad = outGpxps * encodeCoresPerGpxps;

  const estimatedCpuCores = round2(decodeLoad + compositeLoad + encodeLoad);
  const estimatedMemoryMb = Math.round(
    70 + req.tiles.length * 28 + 45 + (req.width * req.height) / 90_000,
  );

  const headroom = ctx.cpuCount > 0 ? estimatedCpuCores / ctx.cpuCount : 1;
  let band: ResourceEstimate['band'];
  if (headroom < 0.35) band = 'low';
  else if (headroom < 0.65) band = 'moderate';
  else if (headroom < 0.95) band = 'high';
  else band = 'very-high';

  if (req.encoder === 'libx264' && req.tiles.some((t) => t.streamType === 'main')) {
    notes.push(
      'Software encoding (libx264) with main streams is CPU-heavy. Prefer substreams, or a hardware encoder if available.',
    );
  }
  if (req.tiles.length >= 16 && req.encoder === 'libx264' && req.height >= 1080) {
    notes.push('16-tile 1080p on CPU will likely not keep real-time on a mini PC. Use NVENC/QSV/VAAPI.');
  }
  if (band === 'very-high') {
    notes.push('Estimated CPU exceeds this host. Expect dropped frames unless you reduce fps/resolution or use hardware encoding.');
  }
  if (ctx.current.observedCpuPercent !== null) {
    notes.push(
      `Currently running: ${ctx.current.runningMosaics} mosaic(s), ${ctx.current.totalTiles} tiles, ~${Math.round(
        ctx.current.observedCpuPercent,
      )}% CPU observed.`,
    );
  }
  notes.push('This is a rough estimate — verify against the live metrics on the dashboard.');

  return {
    band,
    estimatedCpuCores,
    estimatedMemoryMb,
    decodeLoad: round2(decodeLoad + compositeLoad),
    encodeLoad: round2(encodeLoad),
    notes,
    current: ctx.current,
  };
}

export function hostCpuCount(): number {
  return os.cpus().length || 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
