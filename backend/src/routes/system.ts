import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  systemSettingsSchema,
  systemSettingsUpdateSchema,
  encoderCapabilitiesSchema,
  resourceEstimateRequestSchema,
  resourceEstimateSchema,
  dashboardSummarySchema,
  LAYOUT_PRESETS,
  RESOLUTION_PRESETS,
  FPS_PRESETS,
  BITRATE_PRESETS_KBPS,
  ENCODERS,
  FIT_MODES,
  type SystemSettingsUpdate,
  type ResourceEstimateRequest,
} from 'shared';
import { getSettings, saveSettings } from '../db/repo/settings.js';
import { detectCapabilities, cachedCapabilities } from '../services/ffmpeg-capabilities.js';
import { estimateResources, hostCpuCount } from '../services/resource-estimator.js';
import { getStatusHub } from '../services/registry.js';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/system/settings',
    { schema: { tags: ['system'], summary: 'Get runtime settings', response: { 200: systemSettingsSchema } } },
    async () => getSettings(),
  );

  app.put(
    '/system/settings',
    {
      schema: {
        tags: ['system'],
        summary: 'Update runtime settings',
        body: systemSettingsUpdateSchema,
        response: { 200: systemSettingsSchema },
      },
    },
    async (req) => saveSettings(req.body as SystemSettingsUpdate),
  );

  app.get(
    '/system/capabilities',
    {
      schema: {
        tags: ['system'],
        summary: 'Detected FFmpeg encoders and devices',
        querystring: z.object({ refresh: z.coerce.boolean().default(false) }),
        response: { 200: encoderCapabilitiesSchema },
      },
    },
    async (req) => {
      const refresh = (req.query as { refresh?: boolean }).refresh;
      if (refresh) return detectCapabilities(true);
      return cachedCapabilities() ?? (await detectCapabilities());
    },
  );

  app.get(
    '/system/presets',
    {
      schema: {
        tags: ['system'],
        summary: 'Static option presets for the mosaic designer',
        response: {
          200: z.object({
            layouts: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                rows: z.number(),
                cols: z.number(),
                fixed: z.boolean(),
              }),
            ),
            resolutions: z.array(
              z.object({ id: z.string(), label: z.string(), width: z.number(), height: z.number() }),
            ),
            fps: z.array(z.number()),
            bitratesKbps: z.array(z.number()),
            encoders: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                family: z.string(),
                codec: z.string(),
                note: z.string(),
              }),
            ),
            fitModes: z.array(z.string()),
          }),
        },
      },
    },
    async () => ({
      layouts: LAYOUT_PRESETS.map((l) => ({ ...l })),
      resolutions: RESOLUTION_PRESETS.map((r) => ({ ...r })),
      fps: [...FPS_PRESETS],
      bitratesKbps: [...BITRATE_PRESETS_KBPS],
      encoders: ENCODERS.map((e) => ({ ...e })),
      fitModes: [...FIT_MODES],
    }),
  );

  app.post(
    '/system/estimate',
    {
      schema: {
        tags: ['system'],
        summary: 'Estimate CPU/RAM for a proposed mosaic',
        body: resourceEstimateRequestSchema,
        response: { 200: resourceEstimateSchema },
      },
    },
    async (req) => {
      const hub = getStatusHub();
      const observed = hub.observedProcessLoad();
      return estimateResources(req.body as ResourceEstimateRequest, {
        cpuCount: hostCpuCount(),
        current: {
          runningMosaics: hub
            .listMosaicStatuses()
            .filter((s) => ['running', 'degraded'].includes(s.state)).length,
          totalTiles: observed.tiles,
          observedCpuPercent: observed.cpuPercent,
          observedMemoryMb: observed.memoryMb,
        },
      });
    },
  );

  app.get(
    '/system/dashboard',
    {
      schema: {
        tags: ['system'],
        summary: 'Dashboard summary counters',
        response: { 200: dashboardSummarySchema },
      },
    },
    async () => getStatusHub().buildDashboard(),
  );
}
