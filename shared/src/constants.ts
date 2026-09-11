/**
 * Shared, non-secret constants used by both the backend and the frontend:
 * layout presets, output presets and the enumerations that drive validation.
 */

export interface LayoutPreset {
  id: string;
  label: string;
  rows: number;
  cols: number;
  /** Whether this preset is a fixed grid (false = user-defined custom grid). */
  fixed: boolean;
}

/**
 * Grid presets. Convention is `ROWS x COLS`. `2x1` is two rows stacked
 * vertically; `1x2` is two columns side by side.
 */
export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  { id: '1x1', label: '1 × 1', rows: 1, cols: 1, fixed: true },
  { id: '2x1', label: '2 × 1', rows: 2, cols: 1, fixed: true },
  { id: '1x2', label: '1 × 2', rows: 1, cols: 2, fixed: true },
  { id: '2x2', label: '2 × 2', rows: 2, cols: 2, fixed: true },
  { id: '3x3', label: '3 × 3', rows: 3, cols: 3, fixed: true },
  { id: '4x4', label: '4 × 4', rows: 4, cols: 4, fixed: true },
  { id: '5x5', label: '5 × 5', rows: 5, cols: 5, fixed: true },
  { id: '6x6', label: '6 × 6', rows: 6, cols: 6, fixed: true },
] as const;

/** Upper bounds for a custom grid; keeps the FFmpeg graph and UI sane. */
export const MAX_GRID_ROWS = 8;
export const MAX_GRID_COLS = 8;
/** A single mosaic may reference at most this many camera tiles. */
export const MAX_TILES_PER_MOSAIC = MAX_GRID_ROWS * MAX_GRID_COLS;

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { id: '720p', label: '1280 × 720 (720p)', width: 1280, height: 720 },
  { id: '1080p', label: '1920 × 1080 (1080p)', width: 1920, height: 1080 },
  { id: '1440p', label: '2560 × 1440 (1440p)', width: 2560, height: 1440 },
  { id: '2160p', label: '3840 × 2160 (2160p / 4K)', width: 3840, height: 2160 },
] as const;

export const MIN_DIMENSION = 160;
export const MAX_DIMENSION = 7680;

export const FPS_PRESETS: readonly number[] = [5, 10, 15, 20, 24, 25, 30] as const;
export const MIN_FPS = 1;
export const MAX_FPS = 60;

/** Video bitrate presets, in kbps. */
export const BITRATE_PRESETS_KBPS: readonly number[] = [
  1000, 2000, 4000, 6000, 8000, 10000, 15000, 20000,
] as const;
export const MIN_BITRATE_KBPS = 200;
export const MAX_BITRATE_KBPS = 100000;

export const VIDEO_CODECS = ['h264'] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

export interface EncoderDef {
  id: string;
  label: string;
  /** Family for capability detection & docs. */
  family: 'cpu' | 'vaapi' | 'qsv' | 'nvenc';
  codec: VideoCodec;
  /** Human note shown in the UI. */
  note: string;
}

export const ENCODERS: readonly EncoderDef[] = [
  {
    id: 'libx264',
    label: 'CPU — libx264',
    family: 'cpu',
    codec: 'h264',
    note: 'Always available. Highest CPU cost; fine for small mosaics or low-res substreams.',
  },
  {
    id: 'h264_vaapi',
    label: 'Intel VAAPI — h264_vaapi',
    family: 'vaapi',
    codec: 'h264',
    note: 'Intel iGPU via /dev/dri. Low CPU. Requires the render device to be passed into the container.',
  },
  {
    id: 'h264_qsv',
    label: 'Intel Quick Sync — h264_qsv',
    family: 'qsv',
    codec: 'h264',
    note: 'Intel Quick Sync. Low CPU, good quality. Requires the QSV runtime (see GPU.md).',
  },
  {
    id: 'h264_nvenc',
    label: 'NVIDIA NVENC — h264_nvenc',
    family: 'nvenc',
    codec: 'h264',
    note: 'NVIDIA GPU. Very low CPU. Requires the NVIDIA Container Toolkit (see GPU.md).',
  },
] as const;

export type EncoderId = (typeof ENCODERS)[number]['id'];
export const ENCODER_IDS = ENCODERS.map((e) => e.id) as [EncoderId, ...EncoderId[]];

export const FIT_MODES = ['fit', 'fill', 'crop', 'letterbox'] as const;
export type FitMode = (typeof FIT_MODES)[number];
export const FIT_MODE_LABELS: Record<FitMode, string> = {
  fit: 'Fit — scale down to fit, keep aspect (may leave gaps)',
  fill: 'Fill — stretch to fill the tile, ignore aspect',
  crop: 'Crop — scale to cover the tile, crop the overflow',
  letterbox: 'Letterbox — fit and pad with background colour',
};

export const STREAM_TYPES = ['main', 'sub'] as const;
export type StreamType = (typeof STREAM_TYPES)[number];

export const RTSP_TRANSPORTS = ['tcp', 'udp', 'auto'] as const;
export type RtspTransport = (typeof RTSP_TRANSPORTS)[number];

export const LABEL_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];

/** Lifecycle state of a mosaic's FFmpeg process. */
export const MOSAIC_STATES = [
  'created',
  'starting',
  'running',
  'degraded',
  'stopped',
  'failed',
  'restarting',
] as const;
export type MosaicState = (typeof MOSAIC_STATES)[number];

/** Coarse health rollup used by status pills. */
export const HEALTH_LEVELS = ['running', 'warning', 'offline', 'unknown'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const CAMERA_TEST_STEPS = [
  'dns',
  'tcp',
  'rtsp',
  'auth',
  'stream',
] as const;
export type CameraTestStep = (typeof CAMERA_TEST_STEPS)[number];

/** Log source channels the UI can filter on. */
export const LOG_SOURCES = ['app', 'ffmpeg', 'mediamtx', 'camera'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Default network-resilience tuning (overridable in Settings). */
export const DEFAULT_RESILIENCE = {
  /** RTSP socket I/O timeout, milliseconds -> FFmpeg `-timeout` (µs). */
  rtspConnectTimeoutMs: 8000,
  /** No-frame watchdog: mark a tile stalled after this long with no output. */
  rtspReadTimeoutMs: 15000,
  /** Base delay for exponential restart backoff. */
  reconnectBaseDelayMs: 2000,
  /** Ceiling for exponential restart backoff. */
  reconnectMaxDelayMs: 60000,
  /** Give up (state = failed) after this many consecutive failed starts. */
  maxRestartAttempts: 10,
  /** A mosaic that stays up this long resets its restart counter. */
  healthyResetMs: 120000,
} as const;

/** Reserved MediaMTX path names the app must never create or delete. */
export const RESERVED_SLUGS = new Set(['all', 'api', 'v3', 'metrics', 'health']);

/** lowercase alphanumerics in hyphen-separated groups; no leading/trailing/double hyphen. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function layoutPresetById(id: string): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((p) => p.id === id);
}
