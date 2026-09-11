import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * Persistence schema. Kept deliberately portable (ISO-8601 text timestamps,
 * JSON text blobs, no SQLite-only column types) so a PostgreSQL dialect can be
 * added later by swapping the driver + `drizzle-orm/pg-core` table builders.
 */

export const cameras = sqliteTable(
  'cameras',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    host: text('host').notNull(),
    mainRtspUrl: text('main_rtsp_url').notNull(),
    subRtspUrl: text('sub_rtsp_url'),
    username: text('username').notNull().default(''),
    /** AES-256-GCM ciphertext blob (see lib/crypto.ts). Never leaves the API. */
    encryptedPassword: text('encrypted_password'),
    transport: text('transport', { enum: ['tcp', 'udp', 'auto'] })
      .notNull()
      .default('tcp'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    onvifHost: text('onvif_host'),
    onvifPort: integer('onvif_port'),
    onvifProfileToken: text('onvif_profile_token'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => ({
    byName: index('cameras_name_idx').on(t.name),
  }),
);

export const mosaics = sqliteTable(
  'mosaics',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    slug: text('slug').notNull(),
    rows: integer('rows').notNull(),
    cols: integer('cols').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fps: integer('fps').notNull(),
    videoBitrateKbps: integer('video_bitrate_kbps').notNull(),
    codec: text('codec', { enum: ['h264'] })
      .notNull()
      .default('h264'),
    encoder: text('encoder').notNull().default('libx264'),
    gopSeconds: real('gop_seconds').notNull().default(2),
    backgroundColor: text('background_color').notNull().default('black'),
    autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => ({
    slugUnique: uniqueIndex('mosaics_slug_unique').on(t.slug),
  }),
);

export const mosaicCells = sqliteTable(
  'mosaic_cells',
  {
    id: text('id').primaryKey(),
    mosaicId: text('mosaic_id')
      .notNull()
      .references(() => mosaics.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    cameraId: text('camera_id').references(() => cameras.id, { onDelete: 'set null' }),
    streamType: text('stream_type', { enum: ['main', 'sub'] })
      .notNull()
      .default('sub'),
    fitMode: text('fit_mode', { enum: ['fit', 'fill', 'crop', 'letterbox'] })
      .notNull()
      .default('letterbox'),
    label: text('label'),
    labelEnabled: integer('label_enabled', { mode: 'boolean' }).notNull().default(true),
    labelPosition: text('label_position')
      .notNull()
      .default('bottom-left'),
    labelFontSize: integer('label_font_size').notNull().default(20),
    labelBgOpacity: real('label_bg_opacity').notNull().default(0.45),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => ({
    cellUnique: uniqueIndex('mosaic_cells_pos_unique').on(t.mosaicId, t.position),
    byMosaic: index('mosaic_cells_mosaic_idx').on(t.mosaicId),
  }),
);

export const systemSettings = sqliteTable('system_settings', {
  id: integer('id').primaryKey().default(1),
  /** JSON blob validated by shared `systemSettingsSchema`. */
  data: text('data').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

/**
 * Bookkeeping for MediaMTX paths the app created. The reconciler only ever
 * adds/deletes paths that appear here — user-defined paths in mediamtx.yml are
 * never touched.
 */
export const mediamtxManagedPaths = sqliteTable('mediamtx_managed_paths', {
  slug: text('slug').primaryKey(),
  mosaicId: text('mosaic_id')
    .notNull()
    .references(() => mosaics.id, { onDelete: 'cascade' }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  lastReconciledAt: text('last_reconciled_at'),
});

export type CameraRow = typeof cameras.$inferSelect;
export type CameraInsert = typeof cameras.$inferInsert;
export type MosaicRow = typeof mosaics.$inferSelect;
export type MosaicInsert = typeof mosaics.$inferInsert;
export type MosaicCellRow = typeof mosaicCells.$inferSelect;
export type MosaicCellInsert = typeof mosaicCells.$inferInsert;
export type ManagedPathRow = typeof mediamtxManagedPaths.$inferSelect;
