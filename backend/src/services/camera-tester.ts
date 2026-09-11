import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect } from 'node:net';
import { loadEnv } from '../config/env.js';
import { getSettings } from '../db/repo/settings.js';
import { withCredentials, rtspEndpoint } from '../lib/rtsp-url.js';
import { redactText } from 'shared';
import type {
  CameraTestResult,
  CameraTestStepResult,
  RtspTransport,
  StreamType,
} from 'shared';

const pExecFile = promisify(execFile);

export interface CameraTestTarget {
  host: string;
  mainRtspUrl: string;
  subRtspUrl: string | null;
  username: string;
  password: string;
  transport: RtspTransport;
}

function step(
  name: CameraTestStepResult['step'],
  ok: boolean,
  message: string,
  startedAt: number,
  skipped = false,
): CameraTestStepResult {
  return { step: name, ok, skipped, durationMs: Date.now() - startedAt, message };
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    const done = (err?: Error): void => {
      sock.destroy();
      if (err) reject(err);
      else resolve();
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done());
    sock.once('timeout', () => done(new Error(`TCP connect to ${host}:${port} timed out`)));
    sock.once('error', (err) => done(err));
  });
}

interface ProbeStreams {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    bit_rate?: string;
  }>;
  format?: { bit_rate?: string };
}

function parseFrameRate(value: string | undefined): number | null {
  if (!value || value === '0/0') return null;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 100) / 100;
}

/**
 * Full connection test: DNS -> TCP -> RTSP DESCRIBE -> auth -> stream/codec.
 * Credentials are injected only into the ffprobe argv; the returned messages
 * are always credential-redacted.
 */
export async function testCameraConnection(
  target: CameraTestTarget,
  streamType: StreamType,
): Promise<CameraTestResult> {
  const env = loadEnv();
  const settings = getSettings();
  const connectTimeoutMs = settings.rtspConnectTimeoutMs;
  const steps: CameraTestStepResult[] = [];

  const url =
    streamType === 'sub' && target.subRtspUrl ? target.subRtspUrl : target.mainRtspUrl;
  const endpoint = rtspEndpoint(url);
  const host = endpoint?.host ?? target.host;
  const port = endpoint?.port ?? 554;

  // 1. DNS
  {
    const t0 = Date.now();
    if (isIP(host)) {
      steps.push(step('dns', true, `${host} is a literal IP address; DNS not required.`, t0, true));
    } else {
      try {
        const res = await lookup(host);
        steps.push(step('dns', true, `Resolved ${host} -> ${res.address}`, t0));
      } catch (err) {
        steps.push(step('dns', false, `Could not resolve "${host}": ${(err as Error).message}`, t0));
        return finalize(steps, streamType, null);
      }
    }
  }

  // 2. TCP
  {
    const t0 = Date.now();
    try {
      await tcpProbe(host, port, connectTimeoutMs);
      steps.push(step('tcp', true, `TCP connection to ${host}:${port} succeeded.`, t0));
    } catch (err) {
      const msg = (err as Error).message;
      const friendly = /ECONNREFUSED/.test(msg)
        ? `Connection refused on ${host}:${port} — is the RTSP port correct?`
        : /timed out/.test(msg)
          ? `TCP connection to ${host}:${port} timed out.`
          : /EHOSTUNREACH|ENETUNREACH/.test(msg)
            ? `No route to host ${host}.`
            : msg;
      steps.push(step('tcp', false, friendly, t0));
      return finalize(steps, streamType, null);
    }
  }

  // 3-5. RTSP DESCRIBE + auth + stream, all via one ffprobe run.
  const rtspStart = Date.now();
  const transportArgs: string[] =
    target.transport === 'udp'
      ? ['-rtsp_transport', 'udp']
      : target.transport === 'auto'
        ? ['-rtsp_flags', 'prefer_tcp']
        : ['-rtsp_transport', 'tcp'];

  const probeUrl = withCredentials(url, target.username || null, target.password || null);
  const args = [
    '-hide_banner',
    '-v',
    'error',
    ...transportArgs,
    '-timeout',
    String(connectTimeoutMs * 1000),
    '-i',
    probeUrl,
    '-show_entries',
    'stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,bit_rate:format=bit_rate',
    '-of',
    'json',
  ];

  let parsed: ProbeStreams | null = null;
  let stderr = '';
  try {
    const res = await pExecFile(env.FFPROBE_PATH, args, {
      timeout: connectTimeoutMs + 6000,
      maxBuffer: 1024 * 1024,
    });
    parsed = JSON.parse(res.stdout || '{}') as ProbeStreams;
    stderr = redactText(res.stderr ?? '');
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    stderr = redactText(e.stderr ?? e.message ?? 'ffprobe failed');
    if (e.stdout) {
      try {
        parsed = JSON.parse(e.stdout) as ProbeStreams;
      } catch {
        /* ignore */
      }
    }

    const authFailed = /401 Unauthorized|Authorization failed|403 Forbidden|method DESCRIBE failed: 401/i.test(
      stderr,
    );
    const timedOut = e.killed || /timed out|Connection timed out|Operation timed out/i.test(stderr);
    const refused = /Connection refused/i.test(stderr);
    const notFound = /404 Not Found|method DESCRIBE failed: 404/i.test(stderr);

    if (authFailed) {
      steps.push(step('rtsp', true, 'RTSP server responded to DESCRIBE.', rtspStart));
      steps.push(
        step(
          'auth',
          false,
          target.username
            ? 'Authentication failed — check the username and password.'
            : 'The camera requires authentication but no credentials were provided.',
          rtspStart,
        ),
      );
      return finalize(steps, streamType, null);
    }
    if (refused) {
      steps.push(step('rtsp', false, 'RTSP connection refused by the camera.', rtspStart));
      return finalize(steps, streamType, null);
    }
    if (notFound) {
      steps.push(
        step('rtsp', false, 'RTSP DESCRIBE returned 404 — the stream path is wrong.', rtspStart),
      );
      return finalize(steps, streamType, null);
    }
    if (timedOut) {
      steps.push(
        step('rtsp', false, `RTSP connection timed out after ${connectTimeoutMs} ms.`, rtspStart),
      );
      return finalize(steps, streamType, null);
    }
    // Reached the server but could not get a usable stream.
    steps.push(step('rtsp', true, 'RTSP server responded.', rtspStart));
    steps.push(step('auth', true, 'Authentication accepted.', rtspStart));
    steps.push(
      step(
        'stream',
        false,
        `Connected, but no decodable video stream was found: ${stderr.split('\n').slice(-1)[0]}`,
        rtspStart,
      ),
    );
    return finalize(steps, streamType, null);
  }

  steps.push(step('rtsp', true, 'RTSP DESCRIBE/SETUP/PLAY succeeded.', rtspStart));
  steps.push(
    step(
      'auth',
      true,
      target.username ? `Authenticated as "${target.username}".` : 'No authentication required.',
      rtspStart,
    ),
  );

  const video = parsed?.streams?.find((s) => s.codec_type === 'video');
  const hasAudio = !!parsed?.streams?.some((s) => s.codec_type === 'audio');
  if (!video) {
    steps.push(step('stream', false, 'Connected, but the camera exposed no video stream.', rtspStart));
    return finalize(steps, streamType, null);
  }

  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate);
  const bitrateKbps = video.bit_rate
    ? Math.round(Number(video.bit_rate) / 1000)
    : parsed?.format?.bit_rate
      ? Math.round(Number(parsed.format.bit_rate) / 1000)
      : null;

  steps.push(
    step(
      'stream',
      true,
      `Video: ${video.codec_name ?? 'unknown'} ${video.width ?? '?'}×${video.height ?? '?'}` +
        `${fps ? ` @ ${fps} fps` : ''}${hasAudio ? ' (has audio)' : ''}.`,
      rtspStart,
    ),
  );

  return finalize(steps, streamType, {
    width: video.width ?? null,
    height: video.height ?? null,
    codec: video.codec_name ?? null,
    pixFmt: video.pix_fmt ?? null,
    fps: fps ?? null,
    bitrateKbps,
    hasAudio,
  });
}

function finalize(
  steps: CameraTestStepResult[],
  streamType: StreamType,
  stream: CameraTestResult['stream'],
): CameraTestResult {
  const ok = steps.every((s) => s.ok || s.skipped);
  const firstFail = steps.find((s) => !s.ok && !s.skipped);
  const summary = ok
    ? `All checks passed for the ${streamType === 'sub' ? 'substream' : 'main stream'}.`
    : firstFail
      ? `Failed at "${firstFail.step}": ${firstFail.message}`
      : 'Connection test failed.';
  return { ok, streamType, steps, summary, stream };
}
