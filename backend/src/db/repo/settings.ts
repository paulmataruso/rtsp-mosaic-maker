import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { systemSettings } from '../schema.js';
import { systemSettingsSchema, type SystemSettings } from 'shared';

/** Settings live as one JSON row; defaults come from the Zod schema. */
export function getSettings(): SystemSettings {
  const row = getDb().select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  if (!row) return systemSettingsSchema.parse({});
  try {
    return systemSettingsSchema.parse(JSON.parse(row.data));
  } catch {
    return systemSettingsSchema.parse({});
  }
}

export function saveSettings(patch: Partial<SystemSettings>): SystemSettings {
  const merged = systemSettingsSchema.parse({ ...getSettings(), ...patch });
  const db = getDb();
  const existing = db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  const data = JSON.stringify(merged);
  if (existing) {
    db.update(systemSettings)
      .set({ data, updatedAt: new Date().toISOString() })
      .where(eq(systemSettings.id, 1))
      .run();
  } else {
    db.insert(systemSettings).values({ id: 1, data, updatedAt: new Date().toISOString() }).run();
  }
  return merged;
}
