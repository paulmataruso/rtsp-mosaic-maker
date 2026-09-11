import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { mediamtxStatusSchema, errorResponseSchema } from 'shared';
import { getMediamtxService } from '../services/mediamtx-service.js';
import { getReconciler } from '../services/registry.js';
import { UpstreamError } from '../lib/errors.js';

export async function mediamtxRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/mediamtx/status',
    {
      schema: {
        tags: ['mediamtx'],
        summary: 'MediaMTX server status + path overview',
        response: { 200: mediamtxStatusSchema },
      },
    },
    async () => {
      const svc = getMediamtxService();
      const snap = svc.getSnapshot() ?? (await svc.pollOnce());
      // The cached snapshot's publicRtspBase was computed in the poll loop with
      // no request context; recompute it against this request's Host header.
      return { ...snap, publicRtspBase: svc.getPublicRtspBase() };
    },
  );

  app.get(
    '/mediamtx/paths',
    {
      schema: {
        tags: ['mediamtx'],
        summary: 'Runtime paths reported by MediaMTX',
        response: {
          200: z.array(
            z.object({
              name: z.string(),
              managed: z.boolean(),
              ready: z.boolean(),
              source: z.string().nullable(),
              tracks: z.array(z.string()),
              readers: z.number(),
              bytesReceived: z.number(),
              bytesSent: z.number(),
            }),
          ),
        },
      },
    },
    async () => {
      const svc = getMediamtxService();
      const snap = svc.getSnapshot() ?? (await svc.pollOnce());
      return snap.paths;
    },
  );

  app.get(
    '/mediamtx/config-paths',
    {
      schema: {
        tags: ['mediamtx'],
        summary: 'Path entries in the MediaMTX configuration',
        response: { 200: z.array(z.record(z.string(), z.unknown())), 502: errorResponseSchema },
      },
    },
    async () => {
      try {
        return await getMediamtxService().client.listConfigPaths();
      } catch (err) {
        throw UpstreamError((err as Error).message);
      }
    },
  );

  app.post(
    '/mediamtx/reconcile',
    {
      schema: {
        tags: ['mediamtx'],
        summary: 'Force a desired-vs-actual reconciliation now',
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async () => {
      await getReconciler().reconcileNow('manual');
      return { ok: true as const };
    },
  );
}
