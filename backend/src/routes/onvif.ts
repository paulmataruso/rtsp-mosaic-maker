import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  onvifDiscoverRequestSchema,
  onvifDeviceSchema,
  onvifProfilesRequestSchema,
  onvifProfilesResultSchema,
  errorResponseSchema,
  type OnvifDiscoverRequest,
  type OnvifProfilesRequest,
} from 'shared';
import { getOnvifService } from '../services/onvif-service.js';
import { UpstreamError } from '../lib/errors.js';

export async function onvifRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/onvif/discover',
    {
      schema: {
        tags: ['onvif'],
        summary: 'WS-Discovery scan for ONVIF devices on the LAN',
        description:
          'Requires UDP multicast reachability — run the container with network_mode: host on Linux. Always returns 200; an empty list means nothing answered.',
        body: onvifDiscoverRequestSchema,
        response: { 200: z.object({ devices: z.array(onvifDeviceSchema) }) },
      },
    },
    async (req) => {
      const body = req.body as OnvifDiscoverRequest;
      return { devices: await getOnvifService().discover(body.timeoutMs ?? 5000) };
    },
  );

  app.post(
    '/onvif/profiles',
    {
      schema: {
        tags: ['onvif'],
        summary: 'Fetch media profiles + RTSP URIs from an ONVIF device',
        body: onvifProfilesRequestSchema,
        response: { 200: onvifProfilesResultSchema, 502: errorResponseSchema },
      },
    },
    async (req) => {
      const body = req.body as Required<OnvifProfilesRequest>;
      try {
        return await getOnvifService().getProfiles({
          host: body.host,
          port: body.port ?? 80,
          username: body.username ?? '',
          password: body.password ?? '',
        });
      } catch (err) {
        throw UpstreamError(`ONVIF request failed: ${(err as Error).message}`);
      }
    },
  );
}
