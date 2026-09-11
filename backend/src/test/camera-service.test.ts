import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../services/camera-monitor.js', () => ({
  getCameraMonitor: () => ({ probeCamera: vi.fn(), getStatus: vi.fn(), getAll: () => [] }),
}));

import { resetDb, sampleCameraInput } from './helpers.js';
import {
  createCamera,
  updateCamera,
  deleteCamera,
  listCameras,
  getCameraDto,
  getCameraRowOrThrow,
  decryptCameraPassword,
  resolveCameraStream,
} from '../services/camera-service.js';
import { cameraCreateSchema } from 'shared';

beforeEach(() => resetDb());

const parse = (over = {}) => cameraCreateSchema.parse({ ...sampleCameraInput, ...over });

describe('camera-service', () => {
  it('creates a camera and never exposes the password', () => {
    const dto = createCamera(parse());
    expect(dto.name).toBe('Front Door');
    expect(dto.hasPassword).toBe(true);
    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('encryptedPassword');
    expect(dto.mainRtspUrl).not.toContain('admin:');
  });

  it('stores the password encrypted and decrypts it on demand', () => {
    const dto = createCamera(parse({ password: 'hunter2' }));
    const row = getCameraRowOrThrow(dto.id);
    expect(row.encryptedPassword).toMatch(/^v1:/);
    expect(row.encryptedPassword).not.toContain('hunter2');
    expect(decryptCameraPassword(row)).toBe('hunter2');
  });

  it('extracts credentials embedded in a pasted RTSP URL', () => {
    const dto = createCamera(
      parse({
        username: '',
        password: undefined,
        mainRtspUrl: 'rtsp://bob:s3cr3t@10.0.0.5:554/live',
        subRtspUrl: null,
      }),
    );
    expect(dto.username).toBe('bob');
    expect(dto.mainRtspUrl).toBe('rtsp://10.0.0.5:554/live');
    expect(dto.hasPassword).toBe(true);
    const row = getCameraRowOrThrow(dto.id);
    expect(decryptCameraPassword(row)).toBe('s3cr3t');
  });

  it('update with password undefined leaves it unchanged; "" clears it', () => {
    const dto = createCamera(parse({ password: 'keepme' }));
    updateCamera(dto.id, { name: 'Renamed' });
    expect(decryptCameraPassword(getCameraRowOrThrow(dto.id))).toBe('keepme');
    const after = updateCamera(dto.id, { password: '' });
    expect(after.hasPassword).toBe(false);
    expect(getCameraRowOrThrow(dto.id).encryptedPassword).toBeNull();
  });

  it('sanitises URLs on update', () => {
    const dto = createCamera(parse());
    const updated = updateCamera(dto.id, {
      mainRtspUrl: 'rtsp://x:y@1.2.3.4:554/s',
    });
    expect(updated.mainRtspUrl).toBe('rtsp://1.2.3.4:554/s');
  });

  it('resolveCameraStream picks sub when present, else main', () => {
    const dto = createCamera(parse({ password: 'p' }));
    const row = getCameraRowOrThrow(dto.id);
    expect(resolveCameraStream(row, 'sub').url).toContain('/102');
    expect(resolveCameraStream(row, 'main').url).toContain('/101');
    expect(resolveCameraStream(row, 'main').password).toBe('p');
  });

  it('lists and fetches by id, 404s for missing', () => {
    createCamera(parse());
    expect(listCameras()).toHaveLength(1);
    expect(() => getCameraDto('00000000-0000-0000-0000-000000000000')).toThrow(/not found/i);
  });

  it('deletes a camera', () => {
    const dto = createCamera(parse());
    deleteCamera(dto.id);
    expect(listCameras()).toHaveLength(0);
  });
});
