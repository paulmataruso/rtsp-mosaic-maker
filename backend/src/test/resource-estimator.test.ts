import { describe, it, expect } from 'vitest';
import { estimateResources } from '../services/resource-estimator.js';
import type { ResourceEstimateRequest } from 'shared';

const ctx = {
  cpuCount: 8,
  current: { runningMosaics: 0, totalTiles: 0, observedCpuPercent: null, observedMemoryMb: null },
};

const req = (over: Partial<ResourceEstimateRequest>): ResourceEstimateRequest => ({
  width: 1920,
  height: 1080,
  fps: 15,
  encoder: 'libx264',
  tiles: [],
  ...over,
});

describe('estimateResources', () => {
  it('rates 16×substream / 1080p / 15fps / libx264 as moderate+ on 8 cores', () => {
    const r = estimateResources(
      req({ tiles: Array.from({ length: 16 }, () => ({ streamType: 'sub' as const })) }),
      ctx,
    );
    expect(['moderate', 'high', 'very-high']).toContain(r.band);
    expect(r.estimatedCpuCores).toBeGreaterThan(2);
    expect(r.estimatedMemoryMb).toBeGreaterThan(300);
  });

  it('rates 16×main / 1080p / 15fps / libx264 as high+ on 8 cores', () => {
    const r = estimateResources(
      req({ tiles: Array.from({ length: 16 }, () => ({ streamType: 'main' as const })) }),
      ctx,
    );
    expect(['high', 'very-high']).toContain(r.band);
  });

  it('rates a 4-tile substream 720p mosaic as low/moderate', () => {
    const r = estimateResources(
      req({
        width: 1280,
        height: 720,
        tiles: Array.from({ length: 4 }, () => ({ streamType: 'sub' as const })),
      }),
      ctx,
    );
    expect(['low', 'moderate']).toContain(r.band);
  });

  it('hardware encoders lower the encode load dramatically', () => {
    const tiles = Array.from({ length: 9 }, () => ({ streamType: 'sub' as const }));
    const cpu = estimateResources(req({ tiles, encoder: 'libx264' }), ctx);
    const nvenc = estimateResources(req({ tiles, encoder: 'h264_nvenc' }), ctx);
    expect(nvenc.encodeLoad).toBeLessThan(cpu.encodeLoad);
    expect(nvenc.estimatedCpuCores).toBeLessThan(cpu.estimatedCpuCores);
  });

  it('warns when using main streams with software encoding', () => {
    const r = estimateResources(
      req({ tiles: [{ streamType: 'main' }, { streamType: 'main' }], encoder: 'libx264' }),
      ctx,
    );
    expect(r.notes.some((n) => /substream|hardware/i.test(n))).toBe(true);
  });

  it('flags very-high when the estimate exceeds the host', () => {
    const r = estimateResources(
      req({
        width: 3840,
        height: 2160,
        fps: 30,
        encoder: 'libx264',
        tiles: Array.from({ length: 16 }, () => ({ streamType: 'main' as const })),
      }),
      { ...ctx, cpuCount: 4 },
    );
    expect(r.band).toBe('very-high');
  });
});
