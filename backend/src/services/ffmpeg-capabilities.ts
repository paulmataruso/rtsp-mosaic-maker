import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync } from 'node:fs';
import { ENCODERS, type EncoderCapabilities, type EncoderId } from 'shared';
import { loadEnv } from '../config/env.js';
import { appLog } from '../lib/log-store.js';

const pExecFile = promisify(execFile);

let cache: EncoderCapabilities | undefined;
let inFlight: Promise<EncoderCapabilities> | undefined;

function listDri(): string[] {
  try {
    return readdirSync('/dev/dri')
      .filter((f) => f.startsWith('card') || f.startsWith('renderD'))
      .map((f) => `/dev/dri/${f}`);
  } catch {
    return [];
  }
}

function hasNvidia(): boolean {
  if (existsSync('/dev/nvidia0') || existsSync('/dev/nvidiactl')) return true;
  try {
    // `which nvidia-smi`-ish without a shell.
    return existsSync('/usr/bin/nvidia-smi') || existsSync('/usr/local/nvidia/bin/nvidia-smi');
  } catch {
    return false;
  }
}

async function ffmpegVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await pExecFile(bin, ['-hide_banner', '-version'], { timeout: 5000 });
    const first = stdout.split('\n')[0]?.trim() ?? '';
    // Only trust it if it actually looks like FFmpeg's version banner.
    return /ffmpeg version/i.test(first) ? first : null;
  } catch {
    return null;
  }
}

async function listEncoders(bin: string): Promise<Set<string>> {
  try {
    const { stdout } = await pExecFile(bin, ['-hide_banner', '-encoders'], { timeout: 5000 });
    const set = new Set<string>();
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^[A-Z.]{6}\s+(\S+)/);
      if (m) set.add(m[1]!);
    }
    return set;
  } catch {
    return new Set();
  }
}

/** Actually try a 0.1s encode so "listed" doesn't get mistaken for "works". */
async function probeEncoder(
  bin: string,
  id: EncoderId,
  driDevice: string | undefined,
): Promise<{ ok: boolean; detail: string }> {
  const src = ['-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=0.1:r=5'];
  let vf = 'format=yuv420p';
  const pre: string[] = [];
  if (id === 'h264_vaapi') {
    pre.push('-vaapi_device', driDevice ?? '/dev/dri/renderD128');
    vf = 'format=nv12,hwupload';
  } else if (id === 'h264_qsv') {
    pre.push('-init_hw_device', 'qsv=hw', '-filter_hw_device', 'hw');
    vf = 'format=nv12,hwupload=extra_hw_frames=16';
  }
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    ...pre,
    ...src,
    '-vf',
    vf,
    '-c:v',
    id,
    '-f',
    'null',
    '-',
  ];
  try {
    await pExecFile(bin, args, { timeout: 8000 });
    return { ok: true, detail: 'Verified with a test encode.' };
  } catch (err) {
    const msg = (err as { stderr?: string; message?: string }).stderr?.trim() ||
      (err as Error).message ||
      'unknown error';
    return { ok: false, detail: msg.split('\n').slice(-2).join(' ').slice(0, 300) };
  }
}

export async function detectCapabilities(force = false): Promise<EncoderCapabilities> {
  if (!force && cache) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const env = loadEnv();
    const bin = env.FFMPEG_PATH;
    const dri = listDri();
    const nvidia = hasNvidia();
    const [version, listed] = await Promise.all([ffmpegVersion(bin), listEncoders(bin)]);

    if (!version) {
      cache = {
        ffmpegVersion: null,
        probedAt: new Date().toISOString(),
        encoders: ENCODERS.map((e) => ({
          id: e.id,
          available: false,
          detail:
            e.id === 'libx264'
              ? `FFmpeg not found or not runnable at "${bin}". CPU encoding will be attempted anyway.`
              : `FFmpeg not found at "${bin}".`,
        })),
        devices: { dri, nvidia },
      };
      appLog.warn(`FFmpeg not detected at "${bin}"; capability scan skipped.`);
      return cache;
    }

    const results = await Promise.all(
      ENCODERS.map(async (def) => {
        if (!listed.has(def.id) && listed.size > 0) {
          return {
            id: def.id,
            available: false,
            detail: `Not compiled into this ffmpeg build (${def.id}).`,
          };
        }
        // Skip expensive probes for GPU encoders when no device is present.
        if (def.family === 'vaapi' && dri.length === 0) {
          return { id: def.id, available: false, detail: 'No /dev/dri render device in container.' };
        }
        if (def.family === 'qsv' && dri.length === 0) {
          return { id: def.id, available: false, detail: 'No /dev/dri render device in container.' };
        }
        if (def.family === 'nvenc' && !nvidia) {
          return { id: def.id, available: false, detail: 'No NVIDIA device / driver in container.' };
        }
        const probe = await probeEncoder(bin, def.id, dri.find((d) => d.includes('renderD')));
        return { id: def.id, available: probe.ok, detail: probe.detail };
      }),
    );

    cache = {
      ffmpegVersion: version,
      probedAt: new Date().toISOString(),
      encoders: results,
      devices: { dri, nvidia },
    };
    appLog.info(
      `Encoder capability scan: ${results
        .filter((r) => r.available)
        .map((r) => r.id)
        .join(', ') || 'libx264 only'}`,
    );
    return cache;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}

export function cachedCapabilities(): EncoderCapabilities | undefined {
  return cache;
}
