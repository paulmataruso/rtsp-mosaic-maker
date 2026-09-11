import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { logEntrySchema, logQuerySchema, type LogQuery } from 'shared';
import { logStore } from '../lib/log-store.js';

export async function logRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/logs',
    {
      schema: {
        tags: ['logs'],
        summary: 'Recent structured log entries (newest last)',
        querystring: logQuerySchema,
        response: { 200: z.object({ entries: z.array(logEntrySchema) }) },
      },
    },
    async (req) => ({ entries: logStore.query(req.query as LogQuery) }),
  );
}
