import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { mediamtxManagedPaths, type ManagedPathRow } from '../schema.js';

/** Tracks which MediaMTX paths the app owns (see services/reconciler.ts). */
export function listManagedPaths(): ManagedPathRow[] {
  return getDb().select().from(mediamtxManagedPaths).all();
}

export function getManagedPath(slug: string): ManagedPathRow | undefined {
  return getDb()
    .select()
    .from(mediamtxManagedPaths)
    .where(eq(mediamtxManagedPaths.slug, slug))
    .get();
}

export function upsertManagedPath(slug: string, mosaicId: string): void {
  const db = getDb();
  const existing = getManagedPath(slug);
  if (existing) {
    db.update(mediamtxManagedPaths)
      .set({ mosaicId, lastReconciledAt: new Date().toISOString() })
      .where(eq(mediamtxManagedPaths.slug, slug))
      .run();
  } else {
    db.insert(mediamtxManagedPaths)
      .values({
        slug,
        mosaicId,
        createdAt: new Date().toISOString(),
        lastReconciledAt: new Date().toISOString(),
      })
      .run();
  }
}

export function deleteManagedPath(slug: string): void {
  getDb().delete(mediamtxManagedPaths).where(eq(mediamtxManagedPaths.slug, slug)).run();
}

export function touchManagedPath(slug: string): void {
  getDb()
    .update(mediamtxManagedPaths)
    .set({ lastReconciledAt: new Date().toISOString() })
    .where(eq(mediamtxManagedPaths.slug, slug))
    .run();
}
