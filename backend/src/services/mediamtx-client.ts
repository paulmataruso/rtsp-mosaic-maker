import { UpstreamError } from '../lib/errors.js';

/**
 * Thin, typed wrapper over the MediaMTX Control API (`/v3/*`, default port
 * 9997). Verified against MediaMTX v1.21.0's openapi.yaml.
 *
 * We use the API — not blind edits to mediamtx.yml — for every path mutation
 * so MediaMTX validates and hot-applies each change.
 */

export interface MediamtxPathConf {
  name?: string;
  /** "publisher" = accept an incoming publisher (what mosaics use). */
  source?: string;
  sourceOnDemand?: boolean;
  maxReaders?: number;
  record?: boolean;
  overridePublisher?: boolean;
  [k: string]: unknown;
}

export interface MediamtxTrack {
  codec?: string;
}

export interface MediamtxPath {
  name: string;
  confName: string;
  source: { type: string; id: string } | null;
  ready: boolean;
  online?: boolean;
  readers: Array<{ type: string; id: string }>;
  tracks?: string[];
  tracks2?: MediamtxTrack[];
  bytesReceived?: number;
  bytesSent?: number;
  inboundBytes?: number;
  outboundBytes?: number;
}

export interface MediamtxInfo {
  version: string;
  started: string;
}

interface Paged<T> {
  itemCount: number;
  pageCount: number;
  items: T[];
}

export interface MediamtxClientOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

export class MediamtxClient {
  private readonly base: string;
  private readonly authHeader: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: MediamtxClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.authHeader =
      opts.username && opts.username.length > 0
        ? `Basic ${Buffer.from(`${opts.username}:${opts.password ?? ''}`).toString('base64')}`
        : undefined;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T | undefined }> {
    const headers: Record<string, string> = {};
    if (this.authHeader) headers.Authorization = this.authHeader;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw UpstreamError(
        `MediaMTX API request failed (${method} ${path}): ${(err as Error).message}`,
      );
    }
    if (res.status === 204 || res.status === 200) {
      const text = await res.text();
      const data = text ? (JSON.parse(text) as T) : undefined;
      return { status: res.status, data };
    }
    if (res.status === 404) return { status: 404, data: undefined };
    const errText = await res.text().catch(() => '');
    throw UpstreamError(
      `MediaMTX API ${method} ${path} -> ${res.status} ${res.statusText}${
        errText ? `: ${errText.slice(0, 200)}` : ''
      }`,
    );
  }

  async info(): Promise<MediamtxInfo> {
    const { data } = await this.request<MediamtxInfo>('GET', '/v3/info');
    if (!data) throw UpstreamError('MediaMTX /v3/info returned no body');
    return data;
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.info();
      return true;
    } catch {
      return false;
    }
  }

  private async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let page = 0;
    // itemsPerPage caps at 1000 in MediaMTX; loop just in case.
    for (;;) {
      const { data } = await this.request<Paged<T>>(
        'GET',
        `${path}?page=${page}&itemsPerPage=1000`,
      );
      if (!data) break;
      out.push(...data.items);
      if (page + 1 >= data.pageCount) break;
      page += 1;
    }
    return out;
  }

  listConfigPaths(): Promise<MediamtxPathConf[]> {
    return this.listAll<MediamtxPathConf>('/v3/config/paths/list');
  }

  async getConfigPath(name: string): Promise<MediamtxPathConf | null> {
    const { data } = await this.request<MediamtxPathConf>(
      'GET',
      `/v3/config/paths/get/${encodeURIComponent(name)}`,
    );
    return data ?? null;
  }

  async addConfigPath(name: string, conf: MediamtxPathConf): Promise<void> {
    await this.request('POST', `/v3/config/paths/add/${encodeURIComponent(name)}`, conf);
  }

  async patchConfigPath(name: string, conf: MediamtxPathConf): Promise<void> {
    await this.request('PATCH', `/v3/config/paths/patch/${encodeURIComponent(name)}`, conf);
  }

  async deleteConfigPath(name: string): Promise<void> {
    const { status } = await this.request(
      'DELETE',
      `/v3/config/paths/delete/${encodeURIComponent(name)}`,
    );
    if (status === 404) return; // already gone -> idempotent
  }

  listRuntimePaths(): Promise<MediamtxPath[]> {
    return this.listAll<MediamtxPath>('/v3/paths/list');
  }

  async getRuntimePath(name: string): Promise<MediamtxPath | null> {
    const { data } = await this.request<MediamtxPath>(
      'GET',
      `/v3/paths/get/${encodeURIComponent(name)}`,
    );
    return data ?? null;
  }

  listRtspSessions(): Promise<Array<{ id: string; state: string; path: string }>> {
    return this.listAll('/v3/rtsp/sessions/list');
  }
}
