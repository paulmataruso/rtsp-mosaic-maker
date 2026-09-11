import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated through the async call chain without threading
 * parameters. Currently just the host the client used to reach us, so that
 * rendered RTSP URLs (e.g. a mosaic's `rtspUrl`) default to "whatever address
 * the admin opened the UI on" rather than a hard-coded IP.
 */
interface RequestContext {
  host?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Call from a Fastify `onRequest` hook; persists for the rest of the request. */
export function enterRequestContext(ctx: RequestContext): void {
  storage.enterWith(ctx);
}

/** Hostname (no port) the current request came in on, if inside a request. */
export function getRequestHost(): string | undefined {
  const host = storage.getStore()?.host?.trim();
  if (!host) return undefined;
  // Strip a trailing :port and IPv6 brackets defensively.
  return host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') || undefined;
}
