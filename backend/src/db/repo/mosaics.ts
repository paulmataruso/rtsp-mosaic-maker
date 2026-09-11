import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb } from '../index.js';
import {
  mosaics,
  mosaicCells,
  type MosaicRow,
  type MosaicCellRow,
} from '../schema.js';

function nowIso(): string {
  return new Date().toISOString();
}

export interface MosaicWrite {
  name: string;
  description: string;
  slug: string;
  rows: number;
  cols: number;
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  codec: 'h264';
  encoder: string;
  gopSeconds: number;
  backgroundColor: string;
  autoStart: boolean;
  enabled: boolean;
}

export interface CellWrite {
  position: number;
  cameraId: string | null;
  streamType: 'main' | 'sub';
  fitMode: 'fit' | 'fill' | 'crop' | 'letterbox';
  label: string | null;
  labelEnabled: boolean;
  labelPosition: string;
  labelFontSize: number;
  labelBgOpacity: number;
  enabled: boolean;
}

export interface MosaicWithCells {
  mosaic: MosaicRow;
  cells: MosaicCellRow[];
}

export function listMosaicRows(): MosaicRow[] {
  return getDb().select().from(mosaics).orderBy(mosaics.name).all();
}

export function getMosaicRow(id: string): MosaicRow | undefined {
  return getDb().select().from(mosaics).where(eq(mosaics.id, id)).get();
}

export function getMosaicRowBySlug(slug: string): MosaicRow | undefined {
  return getDb().select().from(mosaics).where(eq(mosaics.slug, slug)).get();
}

export function getCellsForMosaic(mosaicId: string): MosaicCellRow[] {
  return getDb()
    .select()
    .from(mosaicCells)
    .where(eq(mosaicCells.mosaicId, mosaicId))
    .orderBy(mosaicCells.position)
    .all();
}

export function getCellsForMosaics(mosaicIds: string[]): Map<string, MosaicCellRow[]> {
  const out = new Map<string, MosaicCellRow[]>();
  if (mosaicIds.length === 0) return out;
  const rows = getDb()
    .select()
    .from(mosaicCells)
    .where(inArray(mosaicCells.mosaicId, mosaicIds))
    .orderBy(mosaicCells.position)
    .all();
  for (const r of rows) {
    const list = out.get(r.mosaicId) ?? [];
    list.push(r);
    out.set(r.mosaicId, list);
  }
  return out;
}

export function getMosaicWithCells(id: string): MosaicWithCells | undefined {
  const mosaic = getMosaicRow(id);
  if (!mosaic) return undefined;
  return { mosaic, cells: getCellsForMosaic(id) };
}

function writeCells(mosaicId: string, cells: CellWrite[]): void {
  const db = getDb();
  db.delete(mosaicCells).where(eq(mosaicCells.mosaicId, mosaicId)).run();
  for (const c of cells) {
    db.insert(mosaicCells)
      .values({
        id: randomUUID(),
        mosaicId,
        position: c.position,
        cameraId: c.cameraId,
        streamType: c.streamType,
        fitMode: c.fitMode,
        label: c.label,
        labelEnabled: c.labelEnabled,
        labelPosition: c.labelPosition,
        labelFontSize: c.labelFontSize,
        labelBgOpacity: c.labelBgOpacity,
        enabled: c.enabled,
      })
      .run();
  }
}

export function insertMosaic(data: MosaicWrite, cells: CellWrite[]): MosaicWithCells {
  const db = getDb();
  const id = randomUUID();
  const ts = nowIso();
  db.transaction((tx) => {
    tx.insert(mosaics)
      .values({ id, ...data, createdAt: ts, updatedAt: ts })
      .run();
  });
  writeCells(id, cells);
  return getMosaicWithCells(id)!;
}

export function updateMosaicRow(
  id: string,
  patch: Partial<MosaicWrite>,
  cells?: CellWrite[],
): MosaicWithCells | undefined {
  const existing = getMosaicRow(id);
  if (!existing) return undefined;
  const next: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) next[k] = v;
  }
  getDb().update(mosaics).set(next).where(eq(mosaics.id, id)).run();
  if (cells) writeCells(id, cells);
  return getMosaicWithCells(id);
}

export function deleteMosaicRow(id: string): boolean {
  const res = getDb().delete(mosaics).where(eq(mosaics.id, id)).run();
  return res.changes > 0;
}

export function slugExists(slug: string, exceptId?: string): boolean {
  const row = getMosaicRowBySlug(slug);
  return !!row && row.id !== exceptId;
}
