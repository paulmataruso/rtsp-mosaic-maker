import { EventEmitter } from 'node:events';
import type {
  LogEntry,
  MosaicStatus,
  CameraStatus,
  MediamtxStatus,
  DashboardSummary,
} from 'shared';

/** Domain events emitted by services and consumed by the WS layer / status hub. */
export interface BusEvents {
  log: [LogEntry];
  'mosaic.status': [MosaicStatus];
  'mosaic.removed': [{ mosaicId: string }];
  'camera.status': [CameraStatus];
  'mediamtx.status': [MediamtxStatus];
  dashboard: [DashboardSummary];
}

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many subscribers (each WS client + hubs); avoid the default-10 warning.
    this.emitter.setMaxListeners(200);
  }

  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): void {
    this.emitter.emit(event, ...args);
  }

  on<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): () => void {
    this.emitter.on(event, listener as (...a: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...a: unknown[]) => void);
  }
}

/** Process-wide singleton. */
export const bus = new TypedEventBus();
