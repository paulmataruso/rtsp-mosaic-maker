/**
 * Minimal ambient types for the `onvif` package (Roger Hardiman, v0.7.x),
 * which ships no first-party TypeScript definitions. Only the surface we use.
 */
declare module 'onvif' {
  export interface DiscoveryProbeOptions {
    timeout?: number;
    resolve?: boolean;
    /** Network interface addresses to send probes from. */
    device?: string | string[];
  }

  export interface DiscoveryDeviceInfo {
    urn?: string;
    name?: string;
    hardware?: string;
    location?: string;
    types?: string[];
    xaddrs?: Array<string | { href?: string } | URL>;
    scopes?: string[];
    probeMatches?: unknown;
  }

  export interface DiscoveryApi {
    probe(
      options: DiscoveryProbeOptions,
      callback: (err: Error | null, info: DiscoveryDeviceInfo[]) => void,
    ): void;
    on(event: 'device', cb: (info: DiscoveryDeviceInfo, rinfo: unknown, xml: string) => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    removeAllListeners(event?: string): void;
  }
  export const Discovery: DiscoveryApi;

  export interface CamOptions {
    hostname: string;
    username?: string;
    password?: string;
    port?: number;
    timeout?: number;
    preserveAddress?: boolean;
  }

  export interface CamProfile {
    $?: { token?: string };
    token?: string;
    name?: string;
    videoEncoderConfiguration?: {
      encoding?: string;
      resolution?: { width?: number; height?: number };
      rateControl?: { frameRateLimit?: number };
    };
  }

  export interface StreamUri {
    uri: string;
  }

  export class Cam {
    constructor(options: CamOptions, callback: (err: Error | null) => void);
    getProfiles(cb: (err: Error | null, profiles: CamProfile[]) => void): void;
    getStreamUri(
      opts: { protocol?: 'RTSP' | 'HTTP'; profileToken?: string },
      cb: (err: Error | null, stream: StreamUri) => void,
    ): void;
    getDeviceInformation(
      cb: (err: Error | null, info: Record<string, string>) => void,
    ): void;
  }

  // The package is CommonJS; consume it via the default export.
  const onvif: { Discovery: DiscoveryApi; Cam: typeof Cam };
  export default onvif;
}
