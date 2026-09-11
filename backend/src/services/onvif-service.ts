import onvif, {
  type DiscoveryDeviceInfo,
  type CamProfile,
  type Cam as CamInstance,
} from 'onvif';

// `onvif` is CommonJS — consume runtime values via the default export, keep the
// class only as a type for annotations.
const { Discovery, Cam } = onvif;
import { withTimeout } from '../lib/async.js';
import { parseRtspUrl } from '../lib/rtsp-url.js';
import { redactUrl } from 'shared';
import { appLog } from '../lib/log-store.js';
import type { OnvifDevice, OnvifProfile, OnvifProfilesResult } from 'shared';

/**
 * ONVIF integration, kept intentionally small and behind an interface so it can
 * be replaced/extended (PTZ, events, imaging) later without touching callers.
 * Manual RTSP entry never depends on any of this.
 *
 * NOTE: WS-Discovery uses UDP multicast 239.255.255.250:3702, which does not
 * traverse Docker's default bridge network. Run the container with
 * `network_mode: host` (Linux) for discovery to see devices. `getProfiles`
 * works over normal unicast HTTP and is unaffected.
 */
export interface OnvifService {
  discover(timeoutMs: number): Promise<OnvifDevice[]>;
  getProfiles(args: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<OnvifProfilesResult>;
}

function xaddrToString(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (x instanceof URL) return x.toString();
  if (x && typeof x === 'object' && 'href' in x && typeof (x as { href?: string }).href === 'string') {
    return (x as { href: string }).href;
  }
  return null;
}

function scopeValue(scopes: string[] | undefined, key: string): string | null {
  if (!scopes) return null;
  const hit = scopes.find((s) => s.includes(`/${key}/`));
  if (!hit) return null;
  const part = hit.split(`/${key}/`)[1] ?? '';
  try {
    return decodeURIComponent(part) || null;
  } catch {
    return part || null;
  }
}

function toDevice(info: DiscoveryDeviceInfo): OnvifDevice {
  const xaddrs = (info.xaddrs ?? []).map(xaddrToString).filter((v): v is string => !!v);
  let address = '';
  let port = 80;
  const first = xaddrs[0];
  if (first) {
    try {
      const u = new URL(first);
      address = u.hostname;
      port = u.port ? Number(u.port) : 80;
    } catch {
      /* ignore */
    }
  }
  return {
    address,
    port,
    xaddrs,
    name: info.name ?? scopeValue(info.scopes, 'name'),
    hardware: info.hardware ?? scopeValue(info.scopes, 'hardware'),
    scopes: info.scopes ?? [],
  };
}

class DefaultOnvifService implements OnvifService {
  async discover(timeoutMs: number): Promise<OnvifDevice[]> {
    try {
      Discovery.removeAllListeners('error');
    } catch {
      /* ignore */
    }
    const devices = await new Promise<DiscoveryDeviceInfo[]>((resolve) => {
      let settled = false;
      const done = (list: DiscoveryDeviceInfo[]): void => {
        if (settled) return;
        settled = true;
        resolve(list);
      };
      try {
        Discovery.probe({ timeout: timeoutMs, resolve: false }, (err, info) => {
          if (err) {
            appLog.warn(`ONVIF discovery error: ${err.message}`);
            done([]);
            return;
          }
          done(info ?? []);
        });
      } catch (err) {
        appLog.warn(`ONVIF discovery threw: ${(err as Error).message}`);
        done([]);
      }
      setTimeout(() => done([]), timeoutMs + 1500);
    });

    // De-dupe by first xaddr.
    const seen = new Set<string>();
    const out: OnvifDevice[] = [];
    for (const d of devices.map(toDevice)) {
      const key = d.xaddrs[0] ?? d.address;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
    appLog.info(`ONVIF discovery found ${out.length} device(s).`);
    return out;
  }

  async getProfiles(args: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<OnvifProfilesResult> {
    const cam = await withTimeout(
      new Promise<CamInstance>((resolve, reject) => {
        const c = new Cam(
          {
            hostname: args.host,
            username: args.username || undefined,
            password: args.password || undefined,
            port: args.port,
            timeout: 8000,
          },
          (err) => (err ? reject(err) : resolve(c)),
        );
      }),
      12000,
      'ONVIF connect',
    );

    const profiles = await withTimeout(
      new Promise<CamProfile[]>((resolve, reject) => {
        cam.getProfiles((err, p) => (err ? reject(err) : resolve(p ?? [])));
      }),
      12000,
      'ONVIF getProfiles',
    );

    const results: OnvifProfile[] = [];
    for (const p of profiles) {
      const token = p.$?.token ?? p.token ?? '';
      if (!token) continue;
      const vec = p.videoEncoderConfiguration;
      let rtspUri: string | null = null;
      try {
        const stream = await withTimeout(
          new Promise<{ uri: string }>((resolve, reject) => {
            cam.getStreamUri({ protocol: 'RTSP', profileToken: token }, (err, s) =>
              err ? reject(err) : resolve(s),
            );
          }),
          10000,
          'ONVIF getStreamUri',
        );
        // Strip any embedded credentials before returning to the client.
        rtspUri = parseRtspUrl(stream.uri).sanitizedUrl;
      } catch (err) {
        appLog.warn(`ONVIF getStreamUri failed for profile ${token}: ${(err as Error).message}`);
      }
      results.push({
        token,
        name: p.name ?? token,
        resolution: vec?.resolution?.width
          ? { width: vec.resolution.width, height: vec.resolution.height ?? 0 }
          : null,
        fps: vec?.rateControl?.frameRateLimit ?? null,
        encoding: vec?.encoding ?? null,
        rtspUri,
      });
    }

    appLog.info(
      `ONVIF profiles for ${args.host}: ${results
        .map((r) => `${r.name}${r.rtspUri ? ` (${redactUrl(r.rtspUri)})` : ''}`)
        .join(', ')}`,
    );
    return { host: args.host, profiles: results };
  }
}

let singleton: OnvifService | undefined;
export function getOnvifService(): OnvifService {
  if (!singleton) singleton = new DefaultOnvifService();
  return singleton;
}
