import type { CameraDto, CameraCreateInput, CameraUpdateInput } from 'shared';
import { NotFound, Conflict, BadRequest } from '../lib/errors.js';
import { parseRtspUrl } from '../lib/rtsp-url.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import {
  listCameraRows,
  getCameraRow,
  insertCamera,
  updateCameraRow,
  deleteCameraRow,
  rowToDto,
  type CameraWrite,
} from '../db/repo/cameras.js';
import { getCameraMonitor } from './camera-monitor.js';
import { tryGetFfmpegManager } from './registry.js';
import { logStore } from '../lib/log-store.js';
import { getMosaicRow } from '../db/repo/mosaics.js';
import type { CameraRow } from '../db/schema.js';

/** Move any `user:pass@` embedded in a pasted URL into explicit fields. */
function sanitize(url: string | null | undefined): {
  url: string | null;
  embeddedUser: string | null;
  embeddedPass: string | null;
} {
  if (!url) return { url: null, embeddedUser: null, embeddedPass: null };
  const parsed = parseRtspUrl(url);
  return {
    url: parsed.sanitizedUrl,
    embeddedUser: parsed.username,
    embeddedPass: parsed.password,
  };
}

export function listCameras(): CameraDto[] {
  return listCameraRows().map(rowToDto);
}

export function getCameraDto(id: string): CameraDto {
  const row = getCameraRow(id);
  if (!row) throw NotFound('Camera', id);
  return rowToDto(row);
}

export function getCameraRowOrThrow(id: string): CameraRow {
  const row = getCameraRow(id);
  if (!row) throw NotFound('Camera', id);
  return row;
}

export function decryptCameraPassword(row: CameraRow): string {
  if (!row.encryptedPassword) return '';
  try {
    return decryptSecret(row.encryptedPassword);
  } catch {
    logStore.push('error', 'app', `Failed to decrypt stored password for camera "${row.name}".`, {
      cameraId: row.id,
    });
    return '';
  }
}

export function createCamera(input: CameraCreateInput): CameraDto {
  const main = sanitize(input.mainRtspUrl);
  const sub = sanitize(input.subRtspUrl ?? null);

  let username = (input.username ?? '').trim();
  let password = input.password;
  if (!username && main.embeddedUser) {
    username = main.embeddedUser;
    if (password === undefined) password = main.embeddedPass ?? undefined;
  }

  const encryptedPassword =
    password === undefined || password === '' ? null : encryptSecret(password);

  const write: CameraWrite = {
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    host: input.host.trim(),
    mainRtspUrl: main.url!,
    subRtspUrl: sub.url,
    username,
    encryptedPassword,
    transport: input.transport ?? 'tcp',
    enabled: input.enabled ?? true,
    onvifHost: input.onvif?.host ?? null,
    onvifPort: input.onvif?.port ?? null,
    onvifProfileToken: input.onvif?.profileToken ?? null,
  };

  const row = insertCamera(write);
  logStore.push('info', 'app', `Camera "${row.name}" added.`, { cameraId: row.id });
  void getCameraMonitor().probeCamera(row.id);
  return rowToDto(row);
}

export function updateCamera(id: string, patch: CameraUpdateInput): CameraDto {
  const existing = getCameraRow(id);
  if (!existing) throw NotFound('Camera', id);

  const write: Partial<CameraWrite> = {};
  if (patch.name !== undefined) write.name = patch.name.trim();
  if (patch.description !== undefined) write.description = patch.description.trim();
  if (patch.host !== undefined) write.host = patch.host.trim();
  if (patch.transport !== undefined) write.transport = patch.transport;
  if (patch.enabled !== undefined) write.enabled = patch.enabled;

  if (patch.mainRtspUrl !== undefined) {
    const s = sanitize(patch.mainRtspUrl);
    write.mainRtspUrl = s.url!;
  }
  if (patch.subRtspUrl !== undefined) {
    write.subRtspUrl = sanitize(patch.subRtspUrl).url;
  }
  if (patch.username !== undefined) write.username = patch.username.trim();
  if (patch.password !== undefined) {
    write.encryptedPassword = patch.password === '' ? null : encryptSecret(patch.password);
  }
  if (patch.onvif !== undefined) {
    write.onvifHost = patch.onvif?.host ?? null;
    write.onvifPort = patch.onvif?.port ?? null;
    write.onvifProfileToken = patch.onvif?.profileToken ?? null;
  }

  const row = updateCameraRow(id, write);
  if (!row) throw NotFound('Camera', id);
  logStore.push('info', 'app', `Camera "${row.name}" updated.`, { cameraId: row.id });

  // If this camera feeds running mosaics, let them re-plan on next cycle.
  const manager = tryGetFfmpegManager();
  const affected = manager?.mosaicsUsingCamera(id) ?? [];
  for (const mosaicId of affected) {
    logStore.push('info', 'app', `Restarting mosaic to apply camera changes.`, { mosaicId, cameraId: id });
    void manager?.restart(mosaicId);
  }
  void getCameraMonitor().probeCamera(row.id);
  return rowToDto(row);
}

export function deleteCamera(id: string): void {
  const row = getCameraRow(id);
  if (!row) throw NotFound('Camera', id);

  const manager = tryGetFfmpegManager();
  const inUse = manager?.mosaicsUsingCamera(id) ?? [];
  if (inUse.length > 0) {
    const names = inUse.map((mid) => getMosaicRow(mid)?.name ?? mid);
    throw Conflict(
      `Camera "${row.name}" is in use by running mosaic(s): ${names.join(', ')}. Stop them first.`,
      { mosaicIds: inUse },
    );
  }

  if (!deleteCameraRow(id)) throw NotFound('Camera', id);
  logStore.push('info', 'app', `Camera "${row.name}" deleted.`, { cameraId: id });
}

/** Resolve the RTSP URL + creds for a given camera + stream type. */
export function resolveCameraStream(
  row: CameraRow,
  streamType: 'main' | 'sub',
): { url: string; username: string; password: string } {
  const url =
    streamType === 'sub' && row.subRtspUrl ? row.subRtspUrl : row.mainRtspUrl;
  if (!url) throw BadRequest(`Camera "${row.name}" has no ${streamType} stream URL configured.`);
  return { url, username: row.username, password: decryptCameraPassword(row) };
}
