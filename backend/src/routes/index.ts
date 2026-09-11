import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { authRoutes } from './auth.js';
import { cameraRoutes } from './cameras.js';
import { mosaicRoutes } from './mosaics.js';
import { mediamtxRoutes } from './mediamtx.js';
import { systemRoutes } from './system.js';
import { onvifRoutes } from './onvif.js';
import { logRoutes } from './logs.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await healthRoutes(app);
  await authRoutes(app);
  await cameraRoutes(app);
  await mosaicRoutes(app);
  await mediamtxRoutes(app);
  await systemRoutes(app);
  await onvifRoutes(app);
  await logRoutes(app);
}
