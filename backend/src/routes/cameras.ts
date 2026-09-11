import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  cameraCreateSchema,
  cameraUpdateSchema,
  cameraDtoSchema,
  cameraTestRequestSchema,
  cameraTestResultSchema,
  cameraStatusSchema,
  okResponseSchema,
  errorResponseSchema,
  type CameraCreateInput,
  type CameraUpdateInput,
  type CameraTestRequest,
} from 'shared';
import {
  listCameras,
  getCameraDto,
  getCameraRowOrThrow,
  createCamera,
  updateCamera,
  deleteCamera,
  decryptCameraPassword,
} from '../services/camera-service.js';
import { testCameraConnection } from '../services/camera-tester.js';
import { getCameraMonitor } from '../services/camera-monitor.js';

const idParam = z.object({ id: z.string().uuid() });

/**
 * Route handlers deliberately avoid the fastify-zod *type* provider (its deep
 * generic inference blows up tsc on a project this size). Runtime validation
 * and OpenAPI generation still come from the Zod schemas via the globally
 * registered validator/serializer compilers + jsonSchemaTransform.
 */
export async function cameraRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/cameras',
    { schema: { tags: ['cameras'], summary: 'List cameras', response: { 200: z.array(cameraDtoSchema) } } },
    async () => listCameras(),
  );

  app.post(
    '/cameras',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Create a camera',
        body: cameraCreateSchema,
        response: { 201: cameraDtoSchema, 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const dto = createCamera(req.body as CameraCreateInput);
      reply.code(201).send(dto);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/cameras/:id',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Get a camera',
        params: idParam,
        response: { 200: cameraDtoSchema, 404: errorResponseSchema },
      },
    },
    async (req) => getCameraDto(req.params.id),
  );

  app.put<{ Params: { id: string } }>(
    '/cameras/:id',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Update a camera',
        params: idParam,
        body: cameraUpdateSchema,
        response: { 200: cameraDtoSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req) => updateCamera(req.params.id, req.body as CameraUpdateInput),
  );

  app.delete<{ Params: { id: string } }>(
    '/cameras/:id',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Delete a camera',
        params: idParam,
        response: { 200: okResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (req) => {
      deleteCamera(req.params.id);
      return { ok: true as const };
    },
  );

  app.post<{ Params: { id: string }; Body: CameraTestRequest }>(
    '/cameras/:id/test',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Run a connection test (DNS, TCP, RTSP, auth, stream)',
        params: idParam,
        body: cameraTestRequestSchema,
        response: { 200: cameraTestResultSchema, 404: errorResponseSchema },
      },
    },
    async (req) => {
      const row = getCameraRowOrThrow(req.params.id);
      const body = req.body as CameraTestRequest;
      const o = body.overrides ?? {};
      const result = await testCameraConnection(
        {
          host: o.host ?? row.host,
          mainRtspUrl: o.mainRtspUrl ?? row.mainRtspUrl,
          subRtspUrl: o.subRtspUrl ?? row.subRtspUrl,
          username: o.username ?? row.username,
          password: o.password ?? decryptCameraPassword(row),
          transport: o.transport ?? row.transport,
        },
        body.streamType ?? 'main',
      );
      void getCameraMonitor().probeCamera(row.id);
      return result;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/cameras/:id/status',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Live health of a camera',
        params: idParam,
        response: { 200: cameraStatusSchema, 404: errorResponseSchema },
      },
    },
    async (req) => {
      getCameraRowOrThrow(req.params.id);
      return getCameraMonitor().getStatus(req.params.id);
    },
  );

  app.get(
    '/cameras-status',
    {
      schema: {
        tags: ['cameras'],
        summary: 'Live health of all cameras',
        response: { 200: z.array(cameraStatusSchema) },
      },
    },
    async () => getCameraMonitor().getAll(),
  );
}
