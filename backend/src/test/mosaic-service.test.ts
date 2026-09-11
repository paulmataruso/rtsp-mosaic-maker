import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeManager = {
  isRunning: vi.fn(() => false),
  remove: vi.fn(async () => undefined),
  restart: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  mosaicsUsingCamera: vi.fn(() => [] as string[]),
  listStatuses: vi.fn(() => [] as unknown[]),
};

vi.mock('../services/camera-monitor.js', () => ({
  getCameraMonitor: () => ({
    probeCamera: vi.fn(),
    isKnownDown: () => false,
    isHealthy: () => true,
    getStatus: vi.fn(),
    getAll: () => [],
  }),
}));

vi.mock('../services/mediamtx-service.js', () => ({
  getMediamtxService: () => ({
    ensurePath: vi.fn(async () => undefined),
    removePath: vi.fn(async () => undefined),
    getPublicRtspUrl: (slug: string) => `rtsp://192.168.1.50:8554/${slug}`,
  }),
}));

vi.mock('../services/registry.js', () => ({
  getFfmpegManager: () => fakeManager,
  tryGetFfmpegManager: () => fakeManager,
  getStatusHub: () => ({ getMosaicStatus: () => null, listMosaicStatuses: () => [] }),
  getReconciler: () => ({ reconcileNow: vi.fn() }),
  setFfmpegManager: vi.fn(),
  setStatusHub: vi.fn(),
  setReconciler: vi.fn(),
}));

import { resetDb, sampleCameraInput } from './helpers.js';
import { cameraCreateSchema, mosaicInputSchema } from 'shared';
import { createCamera } from '../services/camera-service.js';
import {
  createMosaic,
  getMosaic,
  updateMosaic,
  deleteMosaic,
  listMosaics,
  planBuild,
  desiredManagedPaths,
} from '../services/mosaic-service.js';

beforeEach(() => {
  resetDb();
  vi.clearAllMocks();
  fakeManager.isRunning.mockReturnValue(false);
  fakeManager.mosaicsUsingCamera.mockReturnValue([]);
});

const mosaicInput = (over: Record<string, unknown> = {}) =>
  mosaicInputSchema.parse({
    name: 'Warehouse',
    rows: 2,
    cols: 2,
    width: 1920,
    height: 1080,
    fps: 15,
    videoBitrateKbps: 4000,
    encoder: 'libx264',
    ...over,
  });

const addCamera = (name: string) =>
  createCamera(cameraCreateSchema.parse({ ...sampleCameraInput, name }));

describe('mosaic-service CRUD', () => {
  it('creates a mosaic, auto-deriving the slug', () => {
    const m = createMosaic(mosaicInput({ name: 'Warehouse Main' }));
    expect(m.slug).toBe('warehouse-main');
    expect(m.rtspUrl).toBe('rtsp://192.168.1.50:8554/warehouse-main');
  });

  it('disambiguates duplicate slugs', () => {
    const a = createMosaic(mosaicInput({ name: 'Lot' }));
    const b = createMosaic(mosaicInput({ name: 'Lot' }));
    expect(a.slug).toBe('lot');
    expect(b.slug).toBe('lot-2');
  });

  it('honours a valid custom slug and rejects an invalid one', () => {
    const m = createMosaic(mosaicInput({ name: 'X', slug: 'front-entrance' }));
    expect(m.slug).toBe('front-entrance');
    expect(() => createMosaic(mosaicInput({ name: 'Y', slug: 'Bad Slug' }))).toThrow();
  });

  it('rejects a cell outside the grid and an unknown camera', () => {
    expect(() =>
      createMosaic(mosaicInput({ rows: 1, cols: 1, cells: [{ position: 3, cameraId: null }] })),
    ).toThrow(/grid/i);
    expect(() =>
      createMosaic(
        mosaicInput({
          cells: [{ position: 0, cameraId: '00000000-0000-0000-0000-000000000000' }],
        }),
      ),
    ).toThrow(/does not exist/i);
  });

  it('updates grid + cells and bumps updatedAt', async () => {
    const cam = addCamera('Cam A');
    const m = createMosaic(mosaicInput({ name: 'Editable' }));
    const updated = await updateMosaic(m.id, {
      rows: 3,
      cols: 3,
      cells: [{ position: 4, cameraId: cam.id, streamType: 'sub', fitMode: 'crop' }],
    });
    expect(updated.rows).toBe(3);
    expect(updated.cells).toHaveLength(1);
    expect(updated.cells[0]!.position).toBe(4);
    expect(updated.cells[0]!.fitMode).toBe('crop');
  });

  it('delete stops FFmpeg, removes the path, and deletes the row', async () => {
    const m = createMosaic(mosaicInput({ name: 'Gone' }));
    await deleteMosaic(m.id);
    expect(fakeManager.remove).toHaveBeenCalledWith(m.id);
    expect(listMosaics()).toHaveLength(0);
    expect(() => getMosaic(m.id)).toThrow(/not found/i);
  });

  it('desiredManagedPaths lists every mosaic slug', () => {
    createMosaic(mosaicInput({ name: 'One' }));
    createMosaic(mosaicInput({ name: 'Two' }));
    expect(desiredManagedPaths().map((d) => d.slug).sort()).toEqual(['one', 'two']);
  });
});

describe('mosaic-service planBuild', () => {
  it('builds an FFmpeg command with one input per camera cell', async () => {
    const a = addCamera('Cam 1');
    const b = addCamera('Cam 2');
    const m = createMosaic(
      mosaicInput({
        name: 'Plan',
        rows: 2,
        cols: 2,
        cells: [
          { position: 0, cameraId: a.id, streamType: 'sub' },
          { position: 3, cameraId: b.id, streamType: 'main' },
        ],
      }),
    );
    const plan = await planBuild(m.id, { suspectCameraIds: new Set() });
    expect(plan.slug).toBe('plan');
    expect(plan.referencedCameraIds.sort()).toEqual([a.id, b.id].sort());
    // 4 inputs (2 cameras + 2 empty colour sources), 2 are camera tiles.
    expect(plan.build.args.filter((x) => x === '-i')).toHaveLength(4);
    expect(plan.tiles.filter((t) => t.render === 'live')).toHaveLength(2);
    expect(plan.build.pretty).toContain('ffmpeg');
  });

  it('renders a suspect camera as an OFFLINE placeholder, keeping the mosaic buildable', async () => {
    const a = addCamera('Cam 1');
    const b = addCamera('Cam 2');
    const m = createMosaic(
      mosaicInput({
        name: 'Degraded',
        rows: 1,
        cols: 2,
        cells: [
          { position: 0, cameraId: a.id },
          { position: 1, cameraId: b.id },
        ],
      }),
    );
    const plan = await planBuild(m.id, { suspectCameraIds: new Set([b.id]) });
    const bTile = plan.tiles.find((t) => t.cameraId === b.id);
    expect(bTile?.render).toBe('placeholder');
    // Only one real RTSP input now.
    expect(plan.build.inputIndexKind.filter((k) => k === 'camera')).toHaveLength(1);
    expect(plan.build.inputIndexKind.filter((k) => k === 'placeholder')).toHaveLength(1);
  });
});
