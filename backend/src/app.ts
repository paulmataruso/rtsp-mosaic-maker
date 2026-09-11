import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { getLogger } from './config/logger.js';
import { AppError } from './lib/errors.js';
import { logStore } from './lib/log-store.js';
import { authPlugin } from './plugins/auth.js';
import { registerRoutes } from './routes/index.js';
import { registerWebsocket } from './ws/index.js';
import { enterRequestContext } from './lib/request-context.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    loggerInstance: getLogger() as unknown as FastifyBaseLogger,
    disableRequestLogging: env.NODE_ENV === 'production' ? false : true,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { allErrors: true } },
  });

  // Zod schemas on routes are validated & serialized at runtime by these
  // compilers, and rendered into OpenAPI by jsonSchemaTransform below. We do
  // NOT enable the fastify-zod *type* provider — its route-generic inference is
  // pathologically slow to type-check at this route count.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Make the request's Host available to services (for rendering public URLs).
  app.addHook('onRequest', async (req) => {
    enterRequestContext({ host: req.hostname });
  });

  await app.register(helmet, {
    // The bundled SPA (Mantine) injects inline <style>; keep other protections.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? true : true,
    credentials: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Camera Mosaic Platform API',
        description:
          'REST API for managing cameras, mosaic streams, FFmpeg processes and MediaMTX paths.',
        version: '1.0.0',
      },
      servers: [{ url: '/' }],
      tags: [
        { name: 'health' },
        { name: 'auth' },
        { name: 'cameras' },
        { name: 'mosaics' },
        { name: 'mediamtx' },
        { name: 'system' },
        { name: 'onvif' },
        { name: 'logs' },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  await app.register(websocket, {
    options: { maxPayload: 1 * 1024 * 1024 },
  });

  await app.register(authPlugin);

  await app.register(
    async (api) => {
      await registerRoutes(api);
    },
    { prefix: '/api' },
  );

  await registerWebsocket(app);

  // Serve the built frontend if present (production image).
  const frontendDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'frontend',
    'dist',
  );
  if (existsSync(join(frontendDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: frontendDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && (req.raw.url.startsWith('/api') || req.raw.url.startsWith('/ws'))) {
        reply.code(404).send({ error: { code: 'not_found', message: 'Route not found.' } });
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      reply.code(404).send({ error: { code: 'not_found', message: 'Route not found.' } });
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (!err.expose || err.statusCode >= 500) {
        logStore.push('error', 'app', `${req.method} ${req.url} -> ${err.code}: ${err.message}`);
      }
      reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed.',
          details: err.flatten(),
        },
      });
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      reply.code(400).send({
        error: {
          code: 'validation_error',
          message: err.message,
          details: (err as { validation?: unknown }).validation,
        },
      });
      return;
    }
    getLogger().error({ err, url: req.url }, 'unhandled error');
    logStore.push('error', 'app', `Unhandled error on ${req.method} ${req.url}: ${err.message}`);
    reply.code(500).send({
      error: { code: 'internal_error', message: 'An unexpected error occurred.' },
    });
  });

  return app;
}
