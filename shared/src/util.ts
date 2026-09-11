import { SLUG_PATTERN, RESERVED_SLUGS } from './constants.js';

/**
 * Turn an arbitrary display name into a MediaMTX-safe path segment.
 *  "Warehouse Main" -> "warehouse-main"
 * Falls back to "mosaic" if nothing usable remains.
 */
export function slugify(input: string): string {
  // NFKD splits accented letters into base + combining mark; the [^a-z0-9]
  // pass below then drops the marks, so "Café" -> "cafe" ... "caf-" -> "caf".
  const base = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : 'mosaic';
}

export interface SlugValidation {
  ok: boolean;
  reason?: string;
}

/** Validate a slug before it is handed to MediaMTX as a path name. */
export function validateSlug(slug: string): SlugValidation {
  if (!slug) return { ok: false, reason: 'Slug is empty.' };
  if (slug.length > 64) return { ok: false, reason: 'Slug must be 64 characters or fewer.' };
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason:
        'Slug must be lowercase letters, digits and single hyphens, and must start/end with a letter or digit.',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: `"${slug}" is reserved and cannot be used as a stream name.` };
  }
  return { ok: true };
}

/**
 * Inject credentials into an RTSP/HTTP URL's userinfo, percent-encoding them so
 * passwords containing `@ : / ?` survive. Returns the input unchanged if there
 * is no username or the string is not a valid URL.
 */
export function withCredentials(
  url: string,
  username?: string | null,
  password?: string | null,
): string {
  if (!username) return url;
  try {
    const u = new URL(url);
    u.username = encodeURIComponent(username);
    u.password = password ? encodeURIComponent(password) : '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Parse an RTSP/HTTP URL, splitting out any embedded `user:pass@` so the app
 * can store credentials separately (encrypted) and never persist them in a URL.
 */
export function parseRtspUrl(input: string): {
  sanitizedUrl: string;
  username: string | null;
  password: string | null;
  host: string | null;
  port: number | null;
} {
  try {
    const u = new URL(input);
    const username = u.username ? decodeURIComponent(u.username) : null;
    const password = u.password ? decodeURIComponent(u.password) : null;
    u.username = '';
    u.password = '';
    return {
      sanitizedUrl: u.toString(),
      username,
      password,
      host: u.hostname || null,
      port: u.port ? Number(u.port) : null,
    };
  } catch {
    return { sanitizedUrl: input, username: null, password: null, host: null, port: null };
  }
}

/**
 * Redact credentials from any RTSP/HTTP URL so it is safe to log or show.
 * `rtsp://bob:s3cret@cam/stream` -> `rtsp://bob:***@cam/stream`
 */
export function redactUrl(value: string): string {
  return value.replace(/:\/\/([^/@:]+)(?::([^/@]+))?@/g, (_m, user: string, pass?: string) =>
    pass ? `://${user}:***@` : `://${user}:***@`,
  );
}

/** Redact anything that looks like credentials from a free-text string. */
export function redactText(value: string): string {
  return value
    .replace(/(rtsp|rtsps|http|https):\/\/[^\s'"]*@/gi, (m) => redactUrl(m))
    .replace(/(password|passwd|pass|pwd)(["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1$2***');
}

/** row-major cell index -> {row, col} for a grid. */
export function indexToRowCol(index: number, cols: number): { row: number; col: number } {
  return { row: Math.floor(index / cols), col: index % cols };
}

export function rowColToIndex(row: number, col: number, cols: number): number {
  return row * cols + col;
}

/** Exponential backoff with full jitter, clamped to [base, max]. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(baseMs + Math.random() * (exp - baseMs + 1));
}
