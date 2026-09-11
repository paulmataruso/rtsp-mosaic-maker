import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getDb } from '../index.js';
import { cameras, type CameraRow } from '../schema.js';
import type { CameraDto } from 'shared';

function nowIso(): string {
  return new Date().toISOString();
}

/** Fields the service layer may write. Password is handled as ciphertext here. */
export interface CameraWrite {
  name: string;
  description: string;
  host: string;
  mainRtspUrl: string;
  subRtspUrl: string | null;
  username: string;
  /** `undefined` = leave unchanged; `null` = clear; string = set ciphertext. */
  encryptedPassword?: string | null;
  transport: 'tcp' | 'udp' | 'auto';
  enabled: boolean;
  onvifHost: string | null;
  onvifPort: number | null;
  onvifProfileToken: string | null;
}

export function rowToDto(row: CameraRow): CameraDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    host: row.host,
    mainRtspUrl: row.mainRtspUrl,
    subRtspUrl: row.subRtspUrl ?? null,
    username: row.username,
    hasPassword: !!row.encryptedPassword,
    transport: row.transport,
    enabled: row.enabled,
    onvif: row.onvifHost
      ? {
          host: row.onvifHost,
          port: row.onvifPort ?? 80,
          profileToken: row.onvifProfileToken ?? null,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCameraRows(): CameraRow[] {
  return getDb().select().from(cameras).orderBy(cameras.name).all();
}

export function getCameraRow(id: string): CameraRow | undefined {
  return getDb().select().from(cameras).where(eq(cameras.id, id)).get();
}

export function insertCamera(data: CameraWrite): CameraRow {
  const id = randomUUID();
  const ts = nowIso();
  getDb()
    .insert(cameras)
    .values({
      id,
      name: data.name,
      description: data.description,
      host: data.host,
      mainRtspUrl: data.mainRtspUrl,
      subRtspUrl: data.subRtspUrl,
      username: data.username,
      encryptedPassword: data.encryptedPassword ?? null,
      transport: data.transport,
      enabled: data.enabled,
      onvifHost: data.onvifHost,
      onvifPort: data.onvifPort,
      onvifProfileToken: data.onvifProfileToken,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return getCameraRow(id)!;
}

export function updateCameraRow(id: string, patch: Partial<CameraWrite>): CameraRow | undefined {
  const existing = getCameraRow(id);
  if (!existing) return undefined;
  const next: Record<string, unknown> = { updatedAt: nowIso() };
  for (const key of [
    'name',
    'description',
    'host',
    'mainRtspUrl',
    'subRtspUrl',
    'username',
    'transport',
    'enabled',
    'onvifHost',
    'onvifPort',
    'onvifProfileToken',
  ] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.encryptedPassword !== undefined) next.encryptedPassword = patch.encryptedPassword;
  getDb().update(cameras).set(next).where(eq(cameras.id, id)).run();
  return getCameraRow(id);
}

export function deleteCameraRow(id: string): boolean {
  const res = getDb().delete(cameras).where(eq(cameras.id, id)).run();
  return res.changes > 0;
}
