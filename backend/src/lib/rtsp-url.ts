import { redactUrl, withCredentials, parseRtspUrl } from 'shared';

export { redactUrl, withCredentials, parseRtspUrl };
export type ParsedRtsp = ReturnType<typeof parseRtspUrl>;

/** Host:port for a raw TCP reachability probe, defaulting to 554. */
export function rtspEndpoint(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    return { host: u.hostname, port: u.port ? Number(u.port) : 554 };
  } catch {
    return null;
  }
}
