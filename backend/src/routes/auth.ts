import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { loginRequestSchema, loginResultSchema, type LoginRequest } from 'shared';
import { Unauthorized } from '../lib/errors.js';
import { logStore } from '../lib/log-store.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/auth/status',
    {
      schema: {
        tags: ['auth'],
        summary: 'Whether app authentication is enabled',
        response: { 200: z.object({ authEnabled: z.boolean() }) },
      },
    },
    async () => ({ authEnabled: app.authEnabled }),
  );

  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange username/password for a bearer token',
        body: loginRequestSchema,
        response: {
          200: loginResultSchema,
          401: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
        },
      },
    },
    async (req) => {
      const { username, password } = req.body as LoginRequest;
      if (!app.authEnabled) return app.issueToken('anonymous');
      if (!app.verifyCredentials(username, password)) {
        logStore.push('warn', 'app', `Failed login attempt for user "${username}".`);
        throw Unauthorized('Invalid username or password.');
      }
      logStore.push('info', 'app', `User "${username}" logged in.`);
      return app.issueToken(username);
    },
  );
}
