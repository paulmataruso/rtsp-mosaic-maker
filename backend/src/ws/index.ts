import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import {
  wsClientMessageSchema,
  WS_CHANNELS,
  type WsChannel,
  type WsServerMessage,
} from 'shared';
import { bus } from '../lib/event-bus.js';
import { getLogger } from '../config/logger.js';
import { getStatusHubInstance } from '../services/status-hub.js';
import { getMediamtxService } from '../services/mediamtx-service.js';
import { getCameraMonitor } from '../services/camera-monitor.js';

interface Client {
  socket: WebSocket;
  channels: Set<WsChannel>;
  alive: boolean;
}

const clients = new Set<Client>();
let wired = false;

function send(client: Client, msg: WsServerMessage): void {
  if (client.socket.readyState !== 1) return;
  try {
    client.socket.send(JSON.stringify(msg));
  } catch {
    /* drop */
  }
}

function broadcast(channel: WsChannel, msg: WsServerMessage): void {
  for (const c of clients) {
    if (c.channels.has(channel)) send(c, msg);
  }
}

function wireBusOnce(): void {
  if (wired) return;
  wired = true;
  bus.on('dashboard', (payload) => broadcast('dashboard', { type: 'dashboard', payload }));
  bus.on('mosaic.status', (payload) => broadcast('mosaics', { type: 'mosaic.status', payload }));
  bus.on('mosaic.removed', (payload) => broadcast('mosaics', { type: 'mosaic.removed', payload }));
  bus.on('camera.status', (payload) => broadcast('cameras', { type: 'camera.status', payload }));
  bus.on('mediamtx.status', (payload) => broadcast('mediamtx', { type: 'mediamtx.status', payload }));
  bus.on('log', (payload) => broadcast('logs', { type: 'log', payload }));
}

export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  wireBusOnce();
  const log = getLogger().child({ component: 'ws' });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        try {
          c.socket.terminate();
        } catch {
          /* noop */
        }
        clients.delete(c);
        continue;
      }
      c.alive = false;
      try {
        c.socket.ping();
      } catch {
        /* noop */
      }
    }
  }, 30_000);
  app.addHook('onClose', async () => clearInterval(heartbeat));

  app.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
    // Optional auth: ?token=<jwt> when APP_AUTH_ENABLED.
    if (app.authEnabled) {
      const token = (req.query as { token?: string } | undefined)?.token;
      try {
        if (!token) throw new Error('missing token');
        app.jwt.verify(token);
      } catch {
        try {
          socket.close(4401, 'unauthorized');
        } catch {
          /* noop */
        }
        return;
      }
    }

    const client: Client = {
      socket,
      channels: new Set<WsChannel>(['dashboard', 'mosaics', 'cameras', 'mediamtx']),
      alive: true,
    };
    clients.add(client);
    log.debug({ clients: clients.size }, 'ws client connected');

    send(client, {
      type: 'hello',
      serverTime: new Date().toISOString(),
      channels: [...WS_CHANNELS],
    });

    // Prime the new client with current snapshots.
    const hub = getStatusHubInstance();
    for (const s of hub.listMosaicStatuses()) send(client, { type: 'mosaic.status', payload: s });
    for (const cs of getCameraMonitor().getAll()) send(client, { type: 'camera.status', payload: cs });
    const mtx = getMediamtxService().getSnapshot();
    if (mtx) send(client, { type: 'mediamtx.status', payload: mtx });
    void hub.buildDashboard().then((d) => send(client, { type: 'dashboard', payload: d }));

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = wsClientMessageSchema.safeParse(parsed);
      if (!result.success) return;
      const msg = result.data;
      if (msg.type === 'ping') {
        send(client, { type: 'pong', serverTime: new Date().toISOString() });
      } else if (msg.type === 'subscribe') {
        for (const ch of msg.channels) client.channels.add(ch);
      } else if (msg.type === 'unsubscribe') {
        for (const ch of msg.channels) client.channels.delete(ch);
      }
    });

    socket.on('close', () => {
      clients.delete(client);
      log.debug({ clients: clients.size }, 'ws client disconnected');
    });
    socket.on('error', () => {
      clients.delete(client);
    });
  });
}
