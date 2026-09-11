import { describe, it, expect } from 'vitest';
import { buildMosaicCommand, type BuildMosaicOptions, type TileInput } from '../services/ffmpeg-command.js';

const baseOpts = (over: Partial<BuildMosaicOptions> = {}): BuildMosaicOptions => ({
  grid: { rows: 3, cols: 3 },
  output: {
    width: 1920,
    height: 1080,
    fps: 15,
    videoBitrateKbps: 6000,
    gopSeconds: 2,
    backgroundColor: 'black',
  },
  encoder: 'libx264',
  tiles: [],
  publish: { rtspBaseUrl: 'rtsp://mediamtx:8554', slug: 'warehouse', transport: 'tcp' },
  resilience: { rtspTimeoutMs: 8000 },
  ffmpeg: { binary: 'ffmpeg', logLevel: 'warning', fontFile: '/f/DejaVuSans.ttf' },
  hw: { vaapiDevice: '/dev/dri/renderD128' },
  ...over,
});

type CameraTile = Extract<TileInput, { kind: 'camera' }>;

function cam(position: number, host: number, streamType: 'main' | 'sub' = 'sub'): CameraTile {
  return {
    kind: 'camera',
    position,
    rtspUrl: `rtsp://10.0.0.${host}:554/stream`,
    username: 'admin',
    password: 'p@ss:word',
    transport: 'tcp',
    streamType,
    fitMode: 'letterbox',
    label: { text: `Cam ${position + 1}`, position: 'bottom-left', fontSize: 20, bgOpacity: 0.4 },
  };
}

const argFor = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const filterGraph = (args: string[]): string => argFor(args, '-filter_complex') ?? '';

describe('buildMosaicCommand', () => {
  it('9 cameras / 3x3 / 1920x1080 / 15fps / H.264 -> correct structure', () => {
    const tiles = Array.from({ length: 9 }, (_, i) => cam(i, 20 + i));
    const built = buildMosaicCommand(baseOpts({ tiles }));

    // One -i per cell (9 total), all camera inputs.
    expect(built.args.filter((a) => a === '-i')).toHaveLength(9);
    expect(built.inputIndexKind).toEqual(Array(9).fill('camera'));

    // Cell size = floor(1920/3) x floor(1080/3) = 640 x 360.
    expect(built.cell).toEqual({ width: 640, height: 360 });

    const graph = filterGraph(built.args);
    // Input pad label must be a PREFIX with no comma before the first filter.
    expect(graph).toContain('[0:v]scale=');
    expect(graph).not.toMatch(/\[\d+:v\],/);
    // Chains separated by ';', filters within a chain by ','.
    expect(graph).toContain('[v0];[1:v]scale=');
    // xstack with 9 inputs and a row-major pixel layout.
    expect(graph).toContain('xstack=inputs=9:layout=');
    expect(graph).toContain('0_0|640_0|1280_0|0_360|640_360|1280_360|0_720|640_720|1280_720');
    expect(graph).toContain(':fill=black');

    // Each tile: scale + pad + fps + drawtext + setsar.
    expect(graph).toContain('scale=640:360:force_original_aspect_ratio=decrease');
    expect(graph).toContain('fps=15');
    expect(graph).toContain('drawtext=');

    // libx264 encode with GOP = fps * gopSeconds = 30.
    expect(built.args).toContain('libx264');
    expect(argFor(built.args, '-g')).toBe('30');
    expect(argFor(built.args, '-b:v')).toBe('6000k');
    expect(argFor(built.args, '-maxrate')).toBe('6000k');

    // Output.
    expect(built.args).toContain('-an');
    expect(argFor(built.args, '-fps_mode')).toBe('cfr');
    expect(built.args[built.args.length - 1]).toBe('rtsp://mediamtx:8554/warehouse');
  });

  it('RTSP inputs are hardened with -rtsp_transport, -timeout (µs) and genpts', () => {
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 1, cols: 1 }, tiles: [cam(0, 5)] }));
    expect(built.args).toContain('-rtsp_transport');
    expect(argFor(built.args, '-timeout')).toBe('8000000'); // 8000ms -> µs
    expect(argFor(built.args, '-fflags')).toContain('+genpts');
    // stimeout must never be used (removed from modern FFmpeg).
    expect(built.args).not.toContain('-stimeout');
    // reconnect* flags are HTTP-only, must not be attached to RTSP inputs.
    expect(built.args).not.toContain('-reconnect');
  });

  it('camera credentials are injected into the input URL and percent-encoded', () => {
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 1, cols: 1 }, tiles: [cam(0, 9)] }));
    const inputUrl = built.args[built.args.lastIndexOf('-i') + 1];
    expect(inputUrl).toBe('rtsp://admin:p%40ss%3Aword@10.0.0.9:554/stream');
    // The pretty (log) string must redact them.
    expect(built.pretty).not.toContain('p@ss');
    expect(built.pretty).toContain(':***@');
  });

  it('empty cells are filled with a background colour source, not skipped', () => {
    const tiles = [cam(0, 1), cam(3, 2)]; // 2x2 grid, positions 1 and 2 empty
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 2, cols: 2 }, tiles }));
    expect(built.args.filter((a) => a === '-i')).toHaveLength(4);
    expect(built.inputIndexKind).toEqual(['camera', 'empty', 'empty', 'camera']);
    const graph = filterGraph(built.args);
    expect(graph).toContain('xstack=inputs=4');
    // lavfi colour sources for the empty cells
    expect(built.args.filter((a) => a === 'lavfi')).toHaveLength(2);
  });

  it('a failed camera is rendered as an OFFLINE placeholder input', () => {
    const tiles: TileInput[] = [
      cam(0, 1),
      { kind: 'placeholder', position: 1, text: 'Loading Dock — OFFLINE', label: null },
      cam(2, 3),
      cam(3, 4),
    ];
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 2, cols: 2 }, tiles }));
    expect(built.inputIndexKind).toEqual(['camera', 'placeholder', 'camera', 'camera']);
    const graph = filterGraph(built.args);
    expect(graph).toContain('Loading Dock');
    // Placeholder must not add an RTSP input.
    expect(built.args.filter((a) => a === '-i')).toHaveLength(4);
    expect(built.args.filter((a) => a === 'lavfi')).toHaveLength(1);
  });

  it('mixed main/substream tiles keep per-tile stream selection', () => {
    const tiles = [cam(0, 1, 'sub'), cam(1, 2, 'main'), cam(2, 3, 'sub'), cam(3, 4, 'sub')];
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 2, cols: 2 }, tiles }));
    // Nothing in the command distinguishes main vs sub except the URL the caller
    // passed, so just assert all four inputs are present & mapped.
    expect(built.inputIndexToPosition).toEqual([0, 1, 2, 3]);
    expect(built.args.filter((a) => a === '-i')).toHaveLength(4);
  });

  it('supports 16 cameras in a 4x4 grid', () => {
    const tiles = Array.from({ length: 16 }, (_, i) => cam(i, 30 + i));
    const built = buildMosaicCommand(
      baseOpts({ grid: { rows: 4, cols: 4 }, output: { ...baseOpts().output, width: 1920, height: 1080 } , tiles }),
    );
    expect(built.args.filter((a) => a === '-i')).toHaveLength(16);
    expect(built.cell).toEqual({ width: 480, height: 270 });
    expect(filterGraph(built.args)).toContain('xstack=inputs=16');
  });

  it('different fit modes emit the right scale/crop/pad chain', () => {
    const modes = ['fit', 'fill', 'crop', 'letterbox'] as const;
    for (const fitMode of modes) {
      const tile: TileInput = { ...cam(0, 1), fitMode, label: null };
      const graph = filterGraph(
        buildMosaicCommand(baseOpts({ grid: { rows: 1, cols: 1 }, tiles: [tile] })).args,
      );
      if (fitMode === 'fill') expect(graph).toContain('scale=1920:1080,setsar=1');
      if (fitMode === 'crop') expect(graph).toContain('force_original_aspect_ratio=increase');
      if (fitMode === 'fit') expect(graph).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black');
      if (fitMode === 'letterbox')
        expect(graph).toContain('pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black'); // bg 'black' normalised
    }
  });

  it('single-cell (1x1) mosaic uses null instead of xstack', () => {
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 1, cols: 1 }, tiles: [cam(0, 1)] }));
    const graph = filterGraph(built.args);
    expect(graph).not.toContain('xstack');
    expect(graph).toContain('null[grid]');
  });

  it('VAAPI encoder adds hw device init and hwupload before encode', () => {
    const built = buildMosaicCommand(
      baseOpts({ encoder: 'h264_vaapi', grid: { rows: 1, cols: 1 }, tiles: [cam(0, 1)] }),
    );
    expect(argFor(built.args, '-vaapi_device')).toBe('/dev/dri/renderD128');
    expect(built.args).toContain('h264_vaapi');
    expect(filterGraph(built.args)).toContain('format=nv12,hwupload');
  });

  it('NVENC encoder selects h264_nvenc with a bitrate cap and system-memory frames', () => {
    const built = buildMosaicCommand(
      baseOpts({ encoder: 'h264_nvenc', grid: { rows: 1, cols: 1 }, tiles: [cam(0, 1)] }),
    );
    expect(built.args).toContain('h264_nvenc');
    expect(argFor(built.args, '-b:v')).toBe('6000k');
    expect(filterGraph(built.args)).toContain('format=yuv420p[vout]');
    expect(filterGraph(built.args)).not.toContain('hwupload');
  });

  it('publishes to rtsp://<base>/<slug> over TCP', () => {
    const built = buildMosaicCommand(baseOpts({ grid: { rows: 1, cols: 1 }, tiles: [cam(0, 1)] }));
    expect(built.args.slice(-5)).toEqual([
      '-f',
      'rtsp',
      '-rtsp_transport',
      'tcp',
      'rtsp://mediamtx:8554/warehouse',
    ]);
  });

  it('rounds odd output dimensions down to even', () => {
    const built = buildMosaicCommand(
      baseOpts({
        grid: { rows: 1, cols: 1 },
        output: { ...baseOpts().output, width: 1921, height: 1081 },
        tiles: [cam(0, 1)],
      }),
    );
    expect(filterGraph(built.args)).toContain('pad=1920:1080');
  });
});
