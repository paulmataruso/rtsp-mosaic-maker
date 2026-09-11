import { getDb } from '../db/index.js';
import { cameras, mosaics, mosaicCells, systemSettings, mediamtxManagedPaths } from '../db/schema.js';
import { runMigrations } from '../db/index.js';

let migrated = false;

/** Ensure the shared in-memory DB has its schema, then wipe all rows. */
export function resetDb(): void {
  if (!migrated) {
    runMigrations();
    migrated = true;
  }
  const db = getDb();
  db.delete(mosaicCells).run();
  db.delete(mediamtxManagedPaths).run();
  db.delete(mosaics).run();
  db.delete(cameras).run();
  db.delete(systemSettings).run();
}

export const sampleCameraInput = {
  name: 'Front Door',
  description: 'Entry cam',
  host: '192.168.1.21',
  mainRtspUrl: 'rtsp://192.168.1.21:554/Streaming/Channels/101',
  subRtspUrl: 'rtsp://192.168.1.21:554/Streaming/Channels/102',
  username: 'admin',
  password: 's3cret',
  transport: 'tcp' as const,
  enabled: true,
  onvif: null,
};
