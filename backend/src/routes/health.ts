import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getMediamtxService } from '../services/mediamtx-service.js';
import { tryGetFfmpegManager } from '../services/registry.js';

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  version: z.string(),
  mediamtx: z.enum(['online', 'offline', 'unknown']),
  ffmpegProcesses: z.number(),
  time: z.string(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness / readiness probe',
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_req, reply) => {
      const mtx = getMediamtxService().getSnapshot();
      const manager = tryGetFfmpegManager();
      const mediamtx = mtx == null ? 'unknown' : mtx.reachable ? 'online' : 'offline';
      const body = {
        status: mediamtx === 'offline' ? ('degraded' as const) : ('ok' as const),
        uptimeSeconds: Math.round(process.uptime()),
        version: process.env.npm_package_version ?? '1.0.0',
        mediamtx,
        ffmpegProcesses: manager?.ffmpegPids().length ?? 0,
        time: new Date().toISOString(),
      };
      reply.code(body.status === 'degraded' ? 503 : 200).send(body);
    },
  );
}
