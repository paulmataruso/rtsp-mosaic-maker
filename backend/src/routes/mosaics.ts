import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  mosaicInputSchema,
  mosaicUpdateSchema,
  mosaicDtoSchema,
  mosaicStatusSchema,
  okResponseSchema,
  errorResponseSchema,
  slugSchema,
  slugify as toSlug,
  validateSlug,
  type MosaicInput,
  type MosaicUpdateInput,
  type MosaicStatus,
} from 'shared';
import {
  listMosaics,
  getMosaic,
  createMosaic,
  updateMosaic,
  deleteMosaic,
  startMosaic,
  stopMosaic,
  restartMosaic,
} from '../services/mosaic-service.js';
import { getStatusHub } from '../services/registry.js';
import { NotFound } from '../lib/errors.js';
import { getMosaicRow } from '../db/repo/mosaics.js';

const idParam = z.object({ id: z.string().uuid() });

function emptyStatus(mosaicId: string, slug: string): MosaicStatus {
  return {
    mosaicId,
    slug,
    state: 'created',
    health: 'unknown',
    pid: null,
    since: null,
    restartCount: 0,
    lastExitCode: null,
    lastError: null,
    backoffUntil: null,
    metrics: {
      fps: null,
      bitrateKbps: null,
      frames: null,
      dropFrames: null,
      dupFrames: null,
      speed: null,
      cpuPercent: null,
      memoryMb: null,
    },
    tiles: [],
    mediamtx: { pathExists: false, publishing: false, readers: 0, tracks: [] },
  };
}

export async function mosaicRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/mosaics',
    { schema: { tags: ['mosaics'], summary: 'List mosaics', response: { 200: z.array(mosaicDtoSchema) } } },
    async () => listMosaics(),
  );

  app.get(
    '/mosaics/slug-preview',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Preview the slug that would be generated for a name',
        querystring: z.object({ name: z.string().min(1) }),
        response: {
          200: z.object({ slug: z.string(), valid: z.boolean(), reason: z.string().nullable() }),
        },
      },
    },
    async (req) => {
      const name = (req.query as { name: string }).name;
      const slug = toSlug(name);
      const v = validateSlug(slug);
      return { slug, valid: v.ok, reason: v.reason ?? null };
    },
  );

  app.post(
    '/mosaics/validate-slug',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Validate a custom slug',
        body: z.object({ slug: slugSchema }),
        response: { 200: z.object({ valid: z.literal(true) }), 400: errorResponseSchema },
      },
    },
    async () => ({ valid: true as const }),
  );

  app.post(
    '/mosaics',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Create a mosaic',
        body: mosaicInputSchema,
        response: { 201: mosaicDtoSchema, 400: errorResponseSchema, 422: errorResponseSchema },
      },
    },
    async (req, reply) => {
      reply.code(201).send(createMosaic(req.body as MosaicInput));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/mosaics/:id',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Get a mosaic',
        params: idParam,
        response: { 200: mosaicDtoSchema, 404: errorResponseSchema },
      },
    },
    async (req) => getMosaic(req.params.id),
  );

  app.put<{ Params: { id: string } }>(
    '/mosaics/:id',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Update a mosaic (restarts FFmpeg if running)',
        params: idParam,
        body: mosaicUpdateSchema,
        response: { 200: mosaicDtoSchema, 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req) => updateMosaic(req.params.id, req.body as MosaicUpdateInput),
  );

  app.delete<{ Params: { id: string } }>(
    '/mosaics/:id',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Delete a mosaic (stops FFmpeg, removes MediaMTX path)',
        params: idParam,
        response: { 200: okResponseSchema, 404: errorResponseSchema, 412: errorResponseSchema },
      },
    },
    async (req) => {
      await deleteMosaic(req.params.id);
      return { ok: true as const };
    },
  );

  for (const action of ['start', 'stop', 'restart'] as const) {
    app.post<{ Params: { id: string } }>(
      `/mosaics/:id/${action}`,
      {
        schema: {
          tags: ['mosaics'],
          summary: `${action[0]!.toUpperCase()}${action.slice(1)} a mosaic's FFmpeg process`,
          params: idParam,
          response: {
            200: mosaicStatusSchema,
            404: errorResponseSchema,
            412: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (req) => {
        if (!getMosaicRow(req.params.id)) throw NotFound('Mosaic', req.params.id);
        if (action === 'start') await startMosaic(req.params.id);
        else if (action === 'stop') await stopMosaic(req.params.id);
        else await restartMosaic(req.params.id);
        return (
          getStatusHub().getMosaicStatus(req.params.id) ??
          emptyStatus(req.params.id, getMosaicRow(req.params.id)?.slug ?? '')
        );
      },
    );
  }

  app.get<{ Params: { id: string } }>(
    '/mosaics/:id/status',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Live status of a mosaic (FFmpeg + MediaMTX)',
        params: idParam,
        response: { 200: mosaicStatusSchema, 404: errorResponseSchema },
      },
    },
    async (req) => {
      const row = getMosaicRow(req.params.id);
      if (!row) throw NotFound('Mosaic', req.params.id);
      return getStatusHub().getMosaicStatus(req.params.id) ?? emptyStatus(req.params.id, row.slug);
    },
  );

  app.get(
    '/mosaics-status',
    {
      schema: {
        tags: ['mosaics'],
        summary: 'Live status of all mosaics',
        response: { 200: z.array(mosaicStatusSchema) },
      },
    },
    async () => getStatusHub().listMosaicStatuses(),
  );
}
