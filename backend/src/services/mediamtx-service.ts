import { MediamtxClient, type MediamtxPath } from './mediamtx-client.js';
import { loadEnv } from '../config/env.js';
import { bus } from '../lib/event-bus.js';
import { logStore } from '../lib/log-store.js';
import { pollLoop } from '../lib/async.js';
import { getRequestHost } from '../lib/request-context.js';
import {
  listManagedPaths,
  upsertManagedPath,
  deleteManagedPath,
  touchManagedPath,
} from '../db/repo/managed-paths.js';
import type { MediamtxStatus } from 'shared';

/** The PathConf we apply for every mosaic output path. */
function mosaicPathConf(): Record<string, unknown> {
  return {
    source: 'publisher',
    sourceOnDemand: false,
    maxReaders: 0, // unlimited
    record: false,
    overridePublisher: true,
  };
}

export class MediamtxService {
  readonly client: MediamtxClient;
  private readonly apiUrl: string;
  private readonly configuredHost: string;
  private readonly rtspPort: number;
  private lastStarted: string | null = null;
  private lastStatus: MediamtxStatus | null = null;
  private stopPoll: (() => void) | undefined;
  private onRestartCb: (() => void) | undefined;

  constructor() {
    const env = loadEnv();
    this.apiUrl = env.MEDIAMTX_API_URL;
    this.configuredHost = env.PUBLIC_HOST.trim();
    this.rtspPort = env.MEDIAMTX_PUBLIC_RTSP_PORT;
    this.client = new MediamtxClient({
      baseUrl: env.MEDIAMTX_API_URL,
      username: env.MEDIAMTX_API_USER || undefined,
      password: env.MEDIAMTX_API_PASS || undefined,
      timeoutMs: 5000,
    });
  }

  /**
   * Host to render in public RTSP URLs:
   *  1. `PUBLIC_HOST` if explicitly configured
   *  2. else the Host header of the current request (what the admin opened)
   *  3. else `localhost` (poll loop / non-request contexts)
   */
  private resolveHost(): string {
    return this.configuredHost || getRequestHost() || 'localhost';
  }

  getPublicRtspBase(): string {
    return `rtsp://${this.resolveHost()}:${this.rtspPort}`;
  }

  getPublicRtspUrl(slug: string): string {
    return `${this.getPublicRtspBase()}/${slug}`;
  }

  onServerRestart(cb: () => void): void {
    this.onRestartCb = cb;
  }

  /** Wait until the MediaMTX API answers, or throw after `timeoutMs`. */
  async waitUntilReady(timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      if (await this.client.isReachable()) {
        logStore.push('info', 'mediamtx', 'MediaMTX Control API is reachable.');
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`MediaMTX API not reachable at ${this.apiUrl} after ${timeoutMs}ms`);
      }
      const delay = Math.min(5000, 500 * attempt);
      logStore.push(
        'warn',
        'mediamtx',
        `Waiting for MediaMTX Control API at ${this.apiUrl} (attempt ${attempt})…`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /** Create the output path for a mosaic slug if it does not already exist. */
  async ensurePath(slug: string, mosaicId: string): Promise<void> {
    const existing = await this.client.getConfigPath(slug);
    if (!existing) {
      await this.client.addConfigPath(slug, mosaicPathConf());
      logStore.push('info', 'mediamtx', `Created MediaMTX path "/${slug}".`, { slug, mosaicId });
    } else {
      // Keep our required knobs applied even if edited elsewhere.
      await this.client.patchConfigPath(slug, mosaicPathConf());
    }
    upsertManagedPath(slug, mosaicId);
  }

  async removePath(slug: string): Promise<void> {
    await this.client.deleteConfigPath(slug);
    deleteManagedPath(slug);
    logStore.push('info', 'mediamtx', `Removed MediaMTX path "/${slug}".`, { slug });
  }

  /**
   * Reconcile desired (DB) vs actual (MediaMTX) managed paths.
   * Only ever touches paths recorded in `mediamtx_managed_paths` — user paths
   * defined in mediamtx.yml are left untouched.
   */
  async reconcile(desired: Array<{ slug: string; mosaicId: string }>): Promise<void> {
    const desiredSlugs = new Set(desired.map((d) => d.slug));
    let actualConfNames: Set<string>;
    try {
      const confPaths = await this.client.listConfigPaths();
      actualConfNames = new Set(confPaths.map((p) => String(p.name ?? '')));
    } catch (err) {
      logStore.push('error', 'mediamtx', `Reconcile aborted: ${(err as Error).message}`);
      return;
    }

    for (const d of desired) {
      try {
        if (!actualConfNames.has(d.slug)) {
          await this.client.addConfigPath(d.slug, mosaicPathConf());
          logStore.push('info', 'mediamtx', `Reconcile: re-created path "/${d.slug}".`, {
            slug: d.slug,
            mosaicId: d.mosaicId,
          });
        }
        upsertManagedPath(d.slug, d.mosaicId);
      } catch (err) {
        logStore.push(
          'error',
          'mediamtx',
          `Reconcile: failed to ensure path "/${d.slug}": ${(err as Error).message}`,
        );
      }
    }

    for (const managed of listManagedPaths()) {
      if (!desiredSlugs.has(managed.slug)) {
        try {
          await this.client.deleteConfigPath(managed.slug);
          logStore.push('info', 'mediamtx', `Reconcile: removed orphan path "/${managed.slug}".`, {
            slug: managed.slug,
          });
        } catch (err) {
          logStore.push(
            'warn',
            'mediamtx',
            `Reconcile: could not delete "/${managed.slug}": ${(err as Error).message}`,
          );
        }
        deleteManagedPath(managed.slug);
      } else {
        touchManagedPath(managed.slug);
      }
    }
  }

  private toStatus(
    reachable: boolean,
    info: { version: string; started: string } | null,
    runtimePaths: MediamtxPath[],
    lastError: string | null,
  ): MediamtxStatus {
    const managedSlugs = new Set(listManagedPaths().map((m) => m.slug));
    return {
      reachable,
      version: info?.version ?? null,
      uptimeSeconds: info?.started
        ? Math.max(0, Math.round((Date.now() - Date.parse(info.started)) / 1000))
        : null,
      apiUrl: this.apiUrl,
      publicRtspBase: this.getPublicRtspBase(),
      paths: runtimePaths.map((p) => ({
        name: p.name,
        managed: managedSlugs.has(p.name),
        ready: Boolean(p.ready),
        source: p.source?.type ?? null,
        tracks:
          p.tracks2?.map((t) => t.codec ?? 'unknown').filter(Boolean) ??
          p.tracks ??
          [],
        readers: p.readers?.length ?? 0,
        bytesReceived: p.inboundBytes ?? p.bytesReceived ?? 0,
        bytesSent: p.outboundBytes ?? p.bytesSent ?? 0,
      })),
      lastError,
    };
  }

  async pollOnce(): Promise<MediamtxStatus> {
    let status: MediamtxStatus;
    try {
      const info = await this.client.info();
      const runtimePaths = await this.client.listRuntimePaths();
      status = this.toStatus(true, info, runtimePaths, null);

      if (this.lastStarted && this.lastStarted !== info.started) {
        logStore.push(
          'warn',
          'mediamtx',
          'MediaMTX restart detected — re-reconciling paths.',
        );
        this.onRestartCb?.();
      }
      this.lastStarted = info.started;
    } catch (err) {
      status = this.toStatus(false, null, [], (err as Error).message);
    }
    this.lastStatus = status;
    bus.emit('mediamtx.status', status);
    return status;
  }

  getSnapshot(): MediamtxStatus | null {
    return this.lastStatus;
  }

  startPolling(intervalMs: number): void {
    this.stopPoll = pollLoop(() => this.pollOnce().then(() => undefined), intervalMs, {
      immediate: true,
      onError: (err) =>
        logStore.push('error', 'mediamtx', `Status poll error: ${(err as Error).message}`),
    });
  }

  stop(): void {
    this.stopPoll?.();
  }
}

let singleton: MediamtxService | undefined;
export function getMediamtxService(): MediamtxService {
  if (!singleton) singleton = new MediamtxService();
  return singleton;
}
