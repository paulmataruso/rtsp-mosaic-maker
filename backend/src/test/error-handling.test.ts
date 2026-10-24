import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Regression test for a real bug: `app.ts` used to call `app.setErrorHandler(...)`
 * AFTER registering every route. Fastify snapshots the error handler in scope
 * per-route at registration time, so every route silently kept Fastify's own
 * default/fallback error handler instead of ours. That fallback builds
 * `{ error: "Bad Request", message, statusCode }` (a STRING `error`) and tries
 * to serialize it against our own `errorResponseSchema` (which requires
 * `error` to be an OBJECT) — the mismatch throws inside Fastify's own
 * fallback-of-a-fallback, and the client got an opaque
 * `FST_ERR_FAILED_ERROR_SERIALIZATION` 500 instead of the intended 400/404/409
 * body. Only reproducible through a real `app.inject()` HTTP round-trip — a
 * unit test that calls a service function directly never exercises Fastify's
 * error-handler/schema-serialization pipeline at all. Fixed by moving
 * `setErrorHandler` before every `app.register(...)` call in app.ts.
 */

vi.mock('../services/mediamtx-service.js', () => ({
  getMediamtxService: () => ({
    ensurePath: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    getPublicRtspUrl: (slug: string) => `rtsp://192.168.1.50:8554/${slug}`,
  }),
}));

// Only what the camera-in-use Conflict case needs; everything else is real.
const { mosaicsUsingCamera } = vi.hoisted(() => ({ mosaicsUsingCamera: vi.fn(() => [] as string[]) }));
vi.mock('../services/registry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/registry.js')>()),
  tryGetFfmpegManager: () => ({ mosaicsUsingCamera }),
}));

import { resetDb } from './helpers.js';
import { insertCamera } from '../db/repo/cameras.js';

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  resetDb();
  mosaicsUsingCamera.mockReturnValue([]);
});

function expectWellFormedError(body: string, expectedCode?: string) {
  const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
  // The regression: a broken error handler produces `error` as a STRING
  // (Fastify's own status text, e.g. "Bad Request") or the request fails
  // schema serialization entirely and never reaches valid JSON at all.
  expect(typeof parsed.error).toBe('object');
  expect(parsed.error).not.toBeNull();
  expect(typeof parsed.error!.message).toBe('string');
  expect(typeof parsed.error!.code).toBe('string');
  if (expectedCode) expect(parsed.error!.code).toBe(expectedCode);
  return parsed.error as { code: string; message: string };
}

const mosaicPayload = (over: Record<string, unknown> = {}) => ({
  name: 'Test Mosaic',
  rows: 1,
  cols: 1,
  width: 640,
  height: 360,
  fps: 15,
  videoBitrateKbps: 2000,
  ...over,
});

describe('error responses are well-formed JSON, not opaque 500s (real HTTP round-trip)', () => {
  it('a request-schema (Zod) validation failure returns a well-formed 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cameras',
      payload: { name: 'Bad Cam', host: 'x', mainRtspUrl: 'not-an-rtsp-url' },
    });
    expect(res.statusCode).toBe(400);
    expectWellFormedError(res.body, 'validation_error');
  });

  it('a superRefine-level validation failure (bad cell position) returns a well-formed 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mosaics',
      payload: mosaicPayload({ cells: [{ position: 5, cameraId: null }] }),
    });
    expect(res.statusCode).toBe(400);
    expectWellFormedError(res.body, 'validation_error');
  });

  it('an app-level BadRequest (cell references a missing camera) returns a well-formed 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mosaics',
      payload: mosaicPayload({ cells: [{ position: 0, cameraId: '11111111-1111-4111-8111-111111111111' }] }),
    });
    expect(res.statusCode).toBe(400);
    const err = expectWellFormedError(res.body, 'bad_request');
    expect(err.message).toMatch(/does not exist/i);
  });

  it('an app-level Conflict (deleting a camera a running mosaic uses) returns a well-formed 409', async () => {
    const cam = insertCamera({
      name: 'In Use Cam',
      description: '',
      host: '192.168.1.21',
      mainRtspUrl: 'rtsp://192.168.1.21:554/stream',
      subRtspUrl: null,
      username: '',
      transport: 'tcp',
      enabled: true,
      onvifHost: null,
      onvifPort: null,
      onvifProfileToken: null,
    });
    mosaicsUsingCamera.mockReturnValue(['22222222-2222-4222-8222-222222222222']);
    const res = await app.inject({ method: 'DELETE', url: `/api/cameras/${cam.id}` });
    expect(res.statusCode).toBe(409);
    const err = expectWellFormedError(res.body, 'conflict');
    expect(err.message).toContain('In Use Cam');
  });

  it('an app-level NotFound returns a well-formed 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/mosaics/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    expectWellFormedError(res.body, 'not_found');
  });
});
