import { create } from 'zustand';
import { useEffect } from 'react';
import type {
  MosaicStatus,
  CameraStatus,
  MediamtxStatus,
  DashboardSummary,
  LogEntry,
  WsServerMessage,
  WsChannel,
} from 'shared';
import { getToken } from '../api/client';

interface LiveState {
  connected: boolean;
  dashboard: DashboardSummary | null;
  mosaics: Record<string, MosaicStatus>;
  cameras: Record<string, CameraStatus>;
  mediamtx: MediamtxStatus | null;
  logs: LogEntry[];
  _apply: (msg: WsServerMessage) => void;
  _setConnected: (v: boolean) => void;
  clearLogs: () => void;
}

const MAX_LOGS = 1000;

export const useLiveStore = create<LiveState>((set) => ({
  connected: false,
  dashboard: null,
  mosaics: {},
  cameras: {},
  mediamtx: null,
  logs: [],
  _setConnected: (v) => set({ connected: v }),
  clearLogs: () => set({ logs: [] }),
  _apply: (msg) =>
    set((state) => {
      switch (msg.type) {
        case 'dashboard':
          return { dashboard: msg.payload };
        case 'mosaic.status':
          return { mosaics: { ...state.mosaics, [msg.payload.mosaicId]: msg.payload } };
        case 'mosaic.removed': {
          const next = { ...state.mosaics };
          delete next[msg.payload.mosaicId];
          return { mosaics: next };
        }
        case 'camera.status':
          return { cameras: { ...state.cameras, [msg.payload.cameraId]: msg.payload } };
        case 'mediamtx.status':
          return { mediamtx: msg.payload };
        case 'log': {
          const logs = [...state.logs, msg.payload];
          if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
          return { logs };
        }
        default:
          return {};
      }
    }),
}));

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let refCount = 0;
const desiredChannels = new Set<WsChannel>(['dashboard', 'mosaics', 'cameras', 'mediamtx']);

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING))
    return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = getToken();
  const url = `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  socket = new WebSocket(url);

  socket.onopen = () => {
    useLiveStore.getState()._setConnected(true);
    socket?.send(JSON.stringify({ type: 'subscribe', channels: [...desiredChannels] }));
  };
  socket.onmessage = (ev) => {
    try {
      useLiveStore.getState()._apply(JSON.parse(ev.data) as WsServerMessage);
    } catch {
      /* ignore malformed */
    }
  };
  socket.onclose = () => {
    useLiveStore.getState()._setConnected(false);
    socket = null;
    if (refCount > 0) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(connect, 2000);
    }
  };
  socket.onerror = () => socket?.close();
}

/** Mount once near the app root to keep a live WS connection. */
export function useLiveConnection(channels?: WsChannel[]): void {
  const channelKey = channels ? channels.join(',') : '';
  useEffect(() => {
    refCount += 1;
    if (channelKey) {
      for (const c of channelKey.split(',') as WsChannel[]) desiredChannels.add(c);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'subscribe', channels: channelKey.split(',') }));
      }
    }
    connect();
    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        window.clearTimeout(reconnectTimer);
        socket?.close();
        socket = null;
      }
    };
  }, [channelKey]);
}

export function subscribeChannel(channel: WsChannel): void {
  desiredChannels.add(channel);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe', channels: [channel] }));
  }
}
