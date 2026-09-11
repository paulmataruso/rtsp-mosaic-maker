import { z } from 'zod';
import {
  mosaicStatusSchema,
  cameraStatusSchema,
  mediamtxStatusSchema,
  dashboardSummarySchema,
  logEntrySchema,
} from './schemas.js';

/**
 * WebSocket wire protocol. One endpoint (`/ws`). The server pushes typed
 * frames; the client sends only `subscribe`/`unsubscribe`/`ping`.
 */

export const WS_CHANNELS = [
  'dashboard',
  'mosaics',
  'cameras',
  'mediamtx',
  'logs',
] as const;
export type WsChannel = (typeof WS_CHANNELS)[number];

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), channels: z.array(z.enum(WS_CHANNELS)) }),
  z.object({ type: z.literal('unsubscribe'), channels: z.array(z.enum(WS_CHANNELS)) }),
  z.object({ type: z.literal('ping') }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), serverTime: z.string(), channels: z.array(z.enum(WS_CHANNELS)) }),
  z.object({ type: z.literal('pong'), serverTime: z.string() }),
  z.object({ type: z.literal('dashboard'), payload: dashboardSummarySchema }),
  z.object({ type: z.literal('mosaic.status'), payload: mosaicStatusSchema }),
  z.object({ type: z.literal('mosaic.removed'), payload: z.object({ mosaicId: z.string() }) }),
  z.object({ type: z.literal('camera.status'), payload: cameraStatusSchema }),
  z.object({ type: z.literal('mediamtx.status'), payload: mediamtxStatusSchema }),
  z.object({ type: z.literal('log'), payload: logEntrySchema }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
