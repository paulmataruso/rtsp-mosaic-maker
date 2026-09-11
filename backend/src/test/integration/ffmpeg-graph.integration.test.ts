import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { buildMosaicCommand, type TileInput } from '../../services/ffmpeg-command.js';

const pExecFile = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Runs REAL ffmpeg against the generated filter graph to prove it parses and
 * produces frames. Uses only placeholder / empty tiles so no RTSP source is
 * needed. Opt in with RUN_INTEGRATION=1 (and ffmpeg on PATH).
 *
 *   RUN_INTEGRATION=1 npm -w backend exec vitest run src/test/integration
 */
const enabled = process.env.RUN_INTEGRATION === '1';

async function ffmpegPresent(): Promise<boolean> {
  if (existsSync(FFMPEG)) return true;
  try {
    await pExecFile(FFMPEG, ['-hide_banner', '-version'], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!enabled)('FFmpeg filter graph (integration)', () => {
  it('a 3x3 mosaic of placeholders + empty cells runs and emits frames', async () => {
    expect(await ffmpegPresent(), `ffmpeg not found at "${FFMPEG}"`).toBe(true);

    const tiles: TileInput[] = [
      { kind: 'placeholder', position: 0, text: 'Cam A — OFFLINE', label: null },
      { kind: 'placeholder', position: 4, text: 'Cam B — OFFLINE', label: { text: 'Center', position: 'top-left', fontSize: 18, bgOpacity: 0.4 } },
      { kind: 'placeholder', position: 8, text: 'Cam C — OFFLINE', label: null },
      // positions 1,2,3,5,6,7 -> empty (background colour)
    ];

    const built = buildMosaicCommand({
      grid: { rows: 3, cols: 3 },
      output: { width: 960, height: 540, fps: 10, videoBitrateKbps: 1500, gopSeconds: 2, backgroundColor: '#101216' },
      encoder: 'libx264',
      tiles,
      publish: { rtspBaseUrl: 'rtsp://unused:8554', slug: 'itest' },
      resilience: { rtspTimeoutMs: 5000 },
      ffmpeg: {
        binary: FFMPEG,
        logLevel: 'error',
        fontFile:
          process.env.FFMPEG_FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      },
    });

    // Swap the RTSP output for a short null sink so it terminates on its own.
    const outIdx = built.args.indexOf('-f');
    const args = built.args.slice(0, outIdx).concat(['-t', '0.5', '-f', 'null', '-']);

    const { stderr } = await pExecFile(FFMPEG, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    expect(stderr).not.toMatch(/No such filter|Filter not found|Error parsing/i);
  }, 40000);

  it('a 2x2 mosaic with one lavfi "camera" and one placeholder runs', async () => {
    expect(await ffmpegPresent()).toBe(true);

    // Fake a camera by pointing the input at a lavfi testsrc via a custom URL —
    // the builder treats it opaquely; we post-process the args to make it lavfi.
    const built = buildMosaicCommand({
      grid: { rows: 2, cols: 2 },
      output: { width: 640, height: 360, fps: 10, videoBitrateKbps: 1000, gopSeconds: 2, backgroundColor: 'black' },
      encoder: 'libx264',
      tiles: [
        {
          kind: 'camera',
          position: 0,
          rtspUrl: 'rtsp://placeholder/stream',
          transport: 'tcp',
          streamType: 'sub',
          fitMode: 'crop',
          label: { text: 'Live', position: 'bottom-left', fontSize: 16, bgOpacity: 0.5 },
        },
        { kind: 'placeholder', position: 3, text: 'Down', label: null },
      ],
      publish: { rtspBaseUrl: 'rtsp://unused:8554', slug: 'itest2' },
      resilience: { rtspTimeoutMs: 5000 },
      ffmpeg: {
        binary: FFMPEG,
        logLevel: 'error',
        fontFile:
          process.env.FFMPEG_FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      },
    });

    // Replace the RTSP input args (`-rtsp_transport ... -i rtsp://...`) with a lavfi testsrc.
    const iIdx = built.args.indexOf('-i');
    const before = built.args.slice(0, built.args.lastIndexOf('-rtsp_transport', iIdx));
    const after = built.args.slice(iIdx + 2);
    const args = [
      ...before,
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10',
      ...after,
    ];
    const outIdx = args.indexOf('-f', args.indexOf('-map'));
    const finalArgs = args.slice(0, outIdx).concat(['-t', '0.5', '-f', 'null', '-']);

    const { stderr } = await pExecFile(FFMPEG, finalArgs, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    expect(stderr).not.toMatch(/No such filter|Filter not found|Error parsing/i);
  }, 40000);
});
