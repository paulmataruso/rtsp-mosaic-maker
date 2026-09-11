import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads a `.env` file (dev convenience) without a dependency, then validates
 * `process.env` with Zod. The result is the single source of truth for
 * configuration; nothing else should read `process.env` directly.
 */
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().default('0.0.0.0'),

  // Empty => auto-detect from each request's Host header (the address the admin
  // used to open the UI). Set it explicitly only for reverse-proxy / VPN setups
  // where the UI address differs from what LAN clients should use for RTSP.
  PUBLIC_HOST: z.string().default(''),

  DATA_DIR: z.string().default('/data'),
  DATABASE_URL: z.string().default('file:/data/app.db'),

  MEDIAMTX_API_URL: z.string().url().default('http://mediamtx:9997'),
  MEDIAMTX_RTSP_URL: z
    .string()
    .regex(/^rtsps?:\/\//, 'must be an rtsp:// URL')
    .default('rtsp://mediamtx:8554'),
  MEDIAMTX_PUBLIC_RTSP_PORT: z.coerce.number().int().min(1).max(65535).default(8554),
  MEDIAMTX_PUBLISH_USER: z.string().default(''),
  MEDIAMTX_PUBLISH_PASS: z.string().default(''),
  /** Optional HTTP Basic auth for the MediaMTX Control API. */
  MEDIAMTX_API_USER: z.string().default(''),
  MEDIAMTX_API_PASS: z.string().default(''),

  APP_SECRET: z.string().default(''),

  APP_AUTH_ENABLED: boolish.default('false'),
  APP_AUTH_USERNAME: z.string().default('admin'),
  APP_AUTH_PASSWORD: z.string().default(''),
  APP_JWT_SECRET: z.string().default(''),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: boolish.default('false'),
  FFMPEG_LOG_LEVEL: z
    .enum(['quiet', 'panic', 'fatal', 'error', 'warning', 'info', 'verbose', 'debug'])
    .default('warning'),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  FFMPEG_FONT_FILE: z
    .string()
    .default('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),

  TZ: z.string().default('UTC'),

  MAX_CONCURRENT_MOSAICS: z.coerce.number().int().min(1).max(64).default(8),
  MAX_TOTAL_TILES: z.coerce.number().int().min(1).max(512).default(64),

  /** Poll intervals (ms). */
  MEDIAMTX_POLL_MS: z.coerce.number().int().min(1000).default(4000),
  CAMERA_MONITOR_MS: z.coerce.number().int().min(5000).default(30000),
  METRICS_POLL_MS: z.coerce.number().int().min(1000).default(3000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const lines = Object.entries(flat).map(([k, v]) => `  - ${k}: ${v?.join(', ')}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.APP_SECRET) {
    // Not fatal: crypto.ts will fall back to a persisted key file, but warn loudly.
    console.warn(
      '[config] APP_SECRET is not set. A key file under DATA_DIR will be used to encrypt camera passwords. Set APP_SECRET for portable, reproducible encryption.',
    );
  }
  if (parsed.data.APP_AUTH_ENABLED && !parsed.data.APP_AUTH_PASSWORD) {
    throw new Error('APP_AUTH_ENABLED is true but APP_AUTH_PASSWORD is empty.');
  }
  cached = parsed.data;
  return cached;
}

/** For tests: override / reset. */
export function __setEnvForTest(env: Partial<Env>): void {
  cached = { ...(cached ?? loadEnv()), ...env } as Env;
}
