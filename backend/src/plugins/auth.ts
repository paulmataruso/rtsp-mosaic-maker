import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';
import { Unauthorized } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    authEnabled: boolean;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueToken: (username: string) => { token: string; expiresIn: number };
    verifyCredentials: (username: string, password: string) => boolean;
  }
}

function resolveJwtSecret(): string {
  const env = loadEnv();
  if (env.APP_JWT_SECRET) return env.APP_JWT_SECRET;
  const path = join(env.DATA_DIR, 'jwt.key');
  try {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
    mkdirSync(env.DATA_DIR, { recursive: true });
    const secret = randomBytes(48).toString('hex');
    writeFileSync(path, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Ephemeral fallback: tokens won't survive a restart, which is acceptable.
    return randomBytes(48).toString('hex');
  }
}

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

/**
 * Optional single-user auth. Disabled by default (LAN appliance). When
 * APP_AUTH_ENABLED=true, every `/api/*` route except health + login requires a
 * Bearer token from `POST /api/auth/login`. Designed so multi-user auth can
 * replace this without touching route handlers.
 */
export const authPlugin = fp(async (fastify) => {
  const env = loadEnv();
  fastify.decorate('authEnabled', env.APP_AUTH_ENABLED);

  await fastify.register(fastifyJwt, {
    secret: resolveJwtSecret(),
    sign: { expiresIn: TOKEN_TTL_SECONDS },
  });

  fastify.decorate('issueToken', (username: string) => ({
    token: fastify.jwt.sign({ sub: username, role: 'admin' }),
    expiresIn: TOKEN_TTL_SECONDS,
  }));

  fastify.decorate('verifyCredentials', (username: string, password: string) => {
    return (
      safeEqual(username, env.APP_AUTH_USERNAME) && safeEqual(password, env.APP_AUTH_PASSWORD)
    );
  });

  fastify.decorate('authenticate', async (req: FastifyRequest) => {
    if (!env.APP_AUTH_ENABLED) return;
    try {
      await req.jwtVerify();
    } catch {
      throw Unauthorized('A valid bearer token is required.');
    }
  });

  // Global guard: protect /api/* except the explicit allowlist.
  const allowlist = new Set(['/api/health', '/api/auth/login', '/api/auth/status']);
  fastify.addHook('onRequest', async (req, reply) => {
    if (!env.APP_AUTH_ENABLED) return;
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/')) return;
    if (allowlist.has(url)) return;
    await fastify.authenticate(req, reply);
  });
});
