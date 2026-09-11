import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediamtxClient } from '../services/mediamtx-client.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function mockFetch(handler: (call: Call) => { status: number; body?: unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers: (init?.headers as Record<string, string>) ?? {},
    };
    const res = handler(call);
    return {
      status: res.status,
      statusText: 'x',
      text: async () => (res.body === undefined ? '' : JSON.stringify(res.body)),
    } as Response;
  });
}

const calls: Call[] = [];

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('MediamtxClient', () => {
  it('GET /v3/info parses version + started', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((c) => {
        calls.push(c);
        return { status: 200, body: { version: '1.21.0', started: '2026-09-10T00:00:00Z' } };
      }),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    const info = await client.info();
    expect(info.version).toBe('1.21.0');
    expect(calls[0]!.url).toBe('http://mtx:9997/v3/info');
    expect(calls[0]!.method).toBe('GET');
  });

  it('addConfigPath POSTs the path config to /v3/config/paths/add/{name}', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((c) => {
        calls.push(c);
        return { status: 200 };
      }),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    await client.addConfigPath('warehouse-main', { source: 'publisher', maxReaders: 0 });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('http://mtx:9997/v3/config/paths/add/warehouse-main');
    expect(calls[0]!.body).toEqual({ source: 'publisher', maxReaders: 0 });
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
  });

  it('patchConfigPath uses PATCH', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((c) => {
        calls.push(c);
        return { status: 200 };
      }),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    await client.patchConfigPath('lot', { record: false });
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain('/v3/config/paths/patch/lot');
  });

  it('deleteConfigPath is idempotent on 404', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ status: 404 })),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    await expect(client.deleteConfigPath('gone')).resolves.toBeUndefined();
  });

  it('listRuntimePaths follows pagination', async () => {
    let page = 0;
    vi.stubGlobal(
      'fetch',
      mockFetch((c) => {
        calls.push(c);
        const p = new URL(c.url).searchParams.get('page');
        page = Number(p);
        return {
          status: 200,
          body: {
            itemCount: 3,
            pageCount: 2,
            items:
              page === 0
                ? [{ name: 'a', readers: [] }, { name: 'b', readers: [] }]
                : [{ name: 'c', readers: [] }],
          },
        };
      }),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    const paths = await client.listRuntimePaths();
    expect(paths.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    expect(calls).toHaveLength(2);
  });

  it('sends HTTP Basic auth when credentials are configured', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch((c) => {
        calls.push(c);
        return { status: 200, body: { version: '1.21.0', started: 'x' } };
      }),
    );
    const client = new MediamtxClient({
      baseUrl: 'http://mtx:9997',
      username: 'admin',
      password: 'pw',
    });
    await client.info();
    expect(calls[0]!.headers.Authorization).toBe(
      `Basic ${Buffer.from('admin:pw').toString('base64')}`,
    );
  });

  it('throws UpstreamError on a 500', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(() => ({ status: 500, body: { error: 'boom' } })),
    );
    const client = new MediamtxClient({ baseUrl: 'http://mtx:9997' });
    await expect(client.info()).rejects.toThrow(/MediaMTX API/);
  });
});
