import { z } from 'zod';
import {
  ENCODER_IDS,
  FIT_MODES,
  STREAM_TYPES,
  RTSP_TRANSPORTS,
  LABEL_POSITIONS,
  VIDEO_CODECS,
  MOSAIC_STATES,
  HEALTH_LEVELS,
  LOG_SOURCES,
  LOG_LEVELS,
  CAMERA_TEST_STEPS,
  MIN_DIMENSION,
  MAX_DIMENSION,
  MIN_FPS,
  MAX_FPS,
  MIN_BITRATE_KBPS,
  MAX_BITRATE_KBPS,
  MAX_GRID_ROWS,
  MAX_GRID_COLS,
} from './constants.js';
import { validateSlug } from './util.js';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const idSchema = z.string().uuid();

const rtspUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => /^rtsps?:\/\//i.test(v), 'Must be an rtsp:// or rtsps:// URL');

const optionalRtspUrlSchema = z
  .union([rtspUrlSchema, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((v, ctx) => {
    const res = validateSlug(v);
    if (!res.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: res.reason });
  });

/* -------------------------------------------------------------------------- */
/* Camera                                                                     */
/* -------------------------------------------------------------------------- */

export const cameraOnvifSchema = z
  .object({
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(80),
    profileToken: z.string().trim().max(255).nullable().default(null),
  })
  .nullable();

export const cameraInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  host: z.string().trim().min(1).max(255),
  mainRtspUrl: rtspUrlSchema,
  subRtspUrl: optionalRtspUrlSchema.default(null),
  username: z.string().trim().max(255).default(''),
  /** Write-only. Absent = leave unchanged on update; empty string = clear. */
  password: z.string().max(255).optional(),
  transport: z.enum(RTSP_TRANSPORTS).default('tcp'),
  enabled: z.boolean().default(true),
  onvif: cameraOnvifSchema.default(null),
});

export const cameraCreateSchema = cameraInputSchema;
export const cameraUpdateSchema = cameraInputSchema.partial();

/** What the API returns. Never contains the password. */
export const cameraDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  host: z.string(),
  mainRtspUrl: z.string(),
  subRtspUrl: z.string().nullable(),
  username: z.string(),
  hasPassword: z.boolean(),
  transport: z.enum(RTSP_TRANSPORTS),
  enabled: z.boolean(),
  onvif: z
    .object({
      host: z.string(),
      port: z.number(),
      profileToken: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Mosaic + cells                                                             */
/* -------------------------------------------------------------------------- */

export const mosaicCellInputSchema = z.object({
  position: z.number().int().min(0).max(MAX_GRID_ROWS * MAX_GRID_COLS - 1),
  cameraId: idSchema.nullable().default(null),
  streamType: z.enum(STREAM_TYPES).default('sub'),
  fitMode: z.enum(FIT_MODES).default('letterbox'),
  label: z.string().trim().max(120).nullable().default(null),
  labelEnabled: z.boolean().default(true),
  labelPosition: z.enum(LABEL_POSITIONS).default('bottom-left'),
  labelFontSize: z.number().int().min(8).max(96).default(20),
  labelBgOpacity: z.number().min(0).max(1).default(0.45),
  enabled: z.boolean().default(true),
});

export const mosaicInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    slug: slugSchema.optional(),
    rows: z.number().int().min(1).max(MAX_GRID_ROWS),
    cols: z.number().int().min(1).max(MAX_GRID_COLS),
    width: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION),
    height: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION),
    fps: z.number().int().min(MIN_FPS).max(MAX_FPS),
    videoBitrateKbps: z.number().int().min(MIN_BITRATE_KBPS).max(MAX_BITRATE_KBPS),
    codec: z.enum(VIDEO_CODECS).default('h264'),
    encoder: z.enum(ENCODER_IDS).default('libx264'),
    gopSeconds: z.number().min(0.5).max(10).default(2),
    backgroundColor: z
      .string()
      .trim()
      .regex(/^#?[0-9a-fA-F]{6}$|^[a-zA-Z]+$/, 'Use a hex colour or a named colour')
      .default('black'),
    autoStart: z.boolean().default(false),
    enabled: z.boolean().default(true),
    cells: z.array(mosaicCellInputSchema).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.width % 2 !== 0 || v.height % 2 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Width and height must be even numbers (H.264 requirement).',
        path: ['width'],
      });
    }
    const capacity = v.rows * v.cols;
    const seen = new Set<number>();
    for (const cell of v.cells) {
      if (cell.position >= capacity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Cell position ${cell.position} is outside a ${v.rows}×${v.cols} grid.`,
          path: ['cells'],
        });
      }
      if (seen.has(cell.position)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate cell at position ${cell.position}.`,
          path: ['cells'],
        });
      }
      seen.add(cell.position);
    }
  });

export const mosaicUpdateSchema = mosaicInputSchema
  .innerType()
  .partial()
  .extend({ cells: z.array(mosaicCellInputSchema).optional() });

export const mosaicCellDtoSchema = mosaicCellInputSchema.extend({
  id: idSchema,
  mosaicId: idSchema,
});

export const mosaicDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string(),
  slug: z.string(),
  rows: z.number(),
  cols: z.number(),
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  videoBitrateKbps: z.number(),
  codec: z.enum(VIDEO_CODECS),
  encoder: z.enum(ENCODER_IDS),
  gopSeconds: z.number(),
  backgroundColor: z.string(),
  autoStart: z.boolean(),
  enabled: z.boolean(),
  cells: z.array(mosaicCellDtoSchema),
  rtspUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/* -------------------------------------------------------------------------- */
/* System settings                                                            */
/* -------------------------------------------------------------------------- */

export const systemSettingsSchema = z.object({
  defaultEncoder: z.enum(ENCODER_IDS).default('libx264'),
  defaultTransport: z.enum(RTSP_TRANSPORTS).default('tcp'),
  defaultStreamType: z.enum(STREAM_TYPES).default('sub'),
  defaultFitMode: z.enum(FIT_MODES).default('letterbox'),
  rtspConnectTimeoutMs: z.number().int().min(1000).max(60000).default(8000),
  rtspReadTimeoutMs: z.number().int().min(2000).max(120000).default(15000),
  reconnectBaseDelayMs: z.number().int().min(500).max(60000).default(2000),
  reconnectMaxDelayMs: z.number().int().min(1000).max(600000).default(60000),
  maxRestartAttempts: z.number().int().min(1).max(1000).default(10),
});
export const systemSettingsUpdateSchema = systemSettingsSchema.partial();

/* -------------------------------------------------------------------------- */
/* Camera connection test                                                     */
/* -------------------------------------------------------------------------- */

export const cameraTestRequestSchema = z.object({
  /** Which stream to probe. */
  streamType: z.enum(STREAM_TYPES).default('main'),
  /** Optional inline overrides so the form can test before saving. */
  overrides: z
    .object({
      host: z.string().trim().min(1).max(255).optional(),
      mainRtspUrl: rtspUrlSchema.optional(),
      subRtspUrl: rtspUrlSchema.optional(),
      username: z.string().max(255).optional(),
      password: z.string().max(255).optional(),
      transport: z.enum(RTSP_TRANSPORTS).optional(),
    })
    .optional(),
});

export const cameraTestStepResultSchema = z.object({
  step: z.enum(CAMERA_TEST_STEPS),
  ok: z.boolean(),
  skipped: z.boolean().default(false),
  durationMs: z.number(),
  message: z.string(),
});

export const cameraTestResultSchema = z.object({
  ok: z.boolean(),
  streamType: z.enum(STREAM_TYPES),
  steps: z.array(cameraTestStepResultSchema),
  summary: z.string(),
  stream: z
    .object({
      width: z.number().nullable(),
      height: z.number().nullable(),
      codec: z.string().nullable(),
      pixFmt: z.string().nullable(),
      fps: z.number().nullable(),
      bitrateKbps: z.number().nullable(),
      hasAudio: z.boolean(),
    })
    .nullable(),
});

/* -------------------------------------------------------------------------- */
/* ONVIF discovery                                                            */
/* -------------------------------------------------------------------------- */

export const onvifDiscoverRequestSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(15000).default(5000),
});

export const onvifDeviceSchema = z.object({
  address: z.string(),
  port: z.number(),
  xaddrs: z.array(z.string()),
  name: z.string().nullable(),
  hardware: z.string().nullable(),
  scopes: z.array(z.string()),
});

export const onvifProfilesRequestSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535).default(80),
  username: z.string().max(255).default(''),
  password: z.string().max(255).default(''),
});

export const onvifProfileSchema = z.object({
  token: z.string(),
  name: z.string(),
  resolution: z.object({ width: z.number(), height: z.number() }).nullable(),
  fps: z.number().nullable(),
  encoding: z.string().nullable(),
  rtspUri: z.string().nullable(),
});

export const onvifProfilesResultSchema = z.object({
  host: z.string(),
  profiles: z.array(onvifProfileSchema),
});

/* -------------------------------------------------------------------------- */
/* Runtime status                                                             */
/* -------------------------------------------------------------------------- */

export const mosaicMetricsSchema = z.object({
  fps: z.number().nullable(),
  bitrateKbps: z.number().nullable(),
  frames: z.number().nullable(),
  dropFrames: z.number().nullable(),
  dupFrames: z.number().nullable(),
  speed: z.number().nullable(),
  cpuPercent: z.number().nullable(),
  memoryMb: z.number().nullable(),
});

export const mosaicTileStatusSchema = z.object({
  position: z.number(),
  cameraId: idSchema.nullable(),
  cameraName: z.string().nullable(),
  streamType: z.enum(STREAM_TYPES),
  render: z.enum(['live', 'placeholder', 'empty']),
});

export const mosaicStatusSchema = z.object({
  mosaicId: idSchema,
  slug: z.string(),
  state: z.enum(MOSAIC_STATES),
  health: z.enum(HEALTH_LEVELS),
  pid: z.number().nullable(),
  since: z.string().nullable(),
  restartCount: z.number(),
  lastExitCode: z.number().nullable(),
  lastError: z.string().nullable(),
  backoffUntil: z.string().nullable(),
  metrics: mosaicMetricsSchema,
  tiles: z.array(mosaicTileStatusSchema),
  mediamtx: z.object({
    pathExists: z.boolean(),
    publishing: z.boolean(),
    readers: z.number(),
    tracks: z.array(z.string()),
  }),
});

export const cameraStatusSchema = z.object({
  cameraId: idSchema,
  health: z.enum(HEALTH_LEVELS),
  enabled: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  rtspConnected: z.boolean(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  codec: z.string().nullable(),
  fps: z.number().nullable(),
  lastFrameAt: z.string().nullable(),
  lastError: z.string().nullable(),
  usedByRunningMosaics: z.array(z.string()),
});

export const mediamtxStatusSchema = z.object({
  reachable: z.boolean(),
  version: z.string().nullable(),
  uptimeSeconds: z.number().nullable(),
  apiUrl: z.string(),
  publicRtspBase: z.string(),
  paths: z.array(
    z.object({
      name: z.string(),
      managed: z.boolean(),
      ready: z.boolean(),
      source: z.string().nullable(),
      tracks: z.array(z.string()),
      readers: z.number(),
      bytesReceived: z.number(),
      bytesSent: z.number(),
    }),
  ),
  lastError: z.string().nullable(),
});

export const dashboardSummarySchema = z.object({
  camerasOnline: z.number(),
  camerasTotal: z.number(),
  mosaicsRunning: z.number(),
  mosaicsTotal: z.number(),
  ffmpegProcesses: z.number(),
  mediamtx: z.enum(['online', 'offline']),
  host: z.object({
    cpuPercent: z.number().nullable(),
    loadAvg1: z.number().nullable(),
    memUsedMb: z.number().nullable(),
    memTotalMb: z.number().nullable(),
    cpuCount: z.number(),
  }),
});

/* -------------------------------------------------------------------------- */
/* Resource estimate                                                          */
/* -------------------------------------------------------------------------- */

export const resourceEstimateRequestSchema = z.object({
  width: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION),
  height: z.number().int().min(MIN_DIMENSION).max(MAX_DIMENSION),
  fps: z.number().int().min(MIN_FPS).max(MAX_FPS),
  encoder: z.enum(ENCODER_IDS),
  tiles: z.array(
    z.object({
      streamType: z.enum(STREAM_TYPES),
      /** Optional known source resolution for a better estimate. */
      sourceWidth: z.number().int().positive().optional(),
      sourceHeight: z.number().int().positive().optional(),
    }),
  ),
  /** Exclude this mosaic id from the "current load" baseline. */
  excludeMosaicId: idSchema.optional(),
});

export const resourceEstimateSchema = z.object({
  band: z.enum(['low', 'moderate', 'high', 'very-high']),
  estimatedCpuCores: z.number(),
  estimatedMemoryMb: z.number(),
  decodeLoad: z.number(),
  encodeLoad: z.number(),
  notes: z.array(z.string()),
  current: z.object({
    runningMosaics: z.number(),
    totalTiles: z.number(),
    observedCpuPercent: z.number().nullable(),
    observedMemoryMb: z.number().nullable(),
  }),
});

/* -------------------------------------------------------------------------- */
/* Encoder capability detection                                               */
/* -------------------------------------------------------------------------- */

export const encoderCapabilitySchema = z.object({
  id: z.enum(ENCODER_IDS),
  available: z.boolean(),
  detail: z.string(),
});
export const encoderCapabilitiesSchema = z.object({
  ffmpegVersion: z.string().nullable(),
  probedAt: z.string(),
  encoders: z.array(encoderCapabilitySchema),
  devices: z.object({
    dri: z.array(z.string()),
    nvidia: z.boolean(),
  }),
});

/* -------------------------------------------------------------------------- */
/* Logs & auth                                                                */
/* -------------------------------------------------------------------------- */

export const logEntrySchema = z.object({
  ts: z.string(),
  level: z.enum(LOG_LEVELS),
  source: z.enum(LOG_SOURCES),
  message: z.string(),
  mosaicId: idSchema.nullable().optional(),
  cameraId: idSchema.nullable().optional(),
  slug: z.string().nullable().optional(),
});

export const logQuerySchema = z.object({
  source: z.enum(LOG_SOURCES).optional(),
  level: z.enum(LOG_LEVELS).optional(),
  mosaicId: idSchema.optional(),
  cameraId: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  since: z.string().datetime().optional(),
});

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export const loginResultSchema = z.object({ token: z.string(), expiresIn: z.number() });

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const okResponseSchema = z.object({ ok: z.literal(true) });
