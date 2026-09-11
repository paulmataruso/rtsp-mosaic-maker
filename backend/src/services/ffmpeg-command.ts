import type { EncoderId, FitMode, LabelPosition, RtspTransport, StreamType } from 'shared';
import { redactText, withCredentials } from 'shared';

/**
 * Pure FFmpeg command builder for a mosaic.
 *
 * Design notes (see docs/FFMPEG.md for the full rationale):
 *  - Every grid cell becomes exactly one FFmpeg input (a live camera, an
 *    "OFFLINE" placeholder, or a plain colour for an empty cell). This makes
 *    the `xstack` layout deterministic and lets the process manager swap a
 *    failed camera for a placeholder without changing the graph shape.
 *  - Decoding and compositing happen in software for predictability across
 *    mixed camera resolutions / frame-rates. Only the final H.264 encode is
 *    offloaded to VAAPI / QSV / NVENC when selected.
 *  - RTSP inputs are hardened with `-rtsp_transport`, `-timeout` (µs) and
 *    `-fflags +genpts+discardcorrupt`. FFmpeg's `-reconnect*` family is HTTP/TCP
 *    only and does NOT apply to RTSP, so cross-restart resilience is the
 *    supervisor's job, not FFmpeg's.
 */

export interface TileLabel {
  text: string;
  position: LabelPosition;
  fontSize: number;
  bgOpacity: number;
}

export type TileInput =
  | {
      kind: 'camera';
      position: number;
      rtspUrl: string;
      username?: string | null;
      password?: string | null;
      transport: RtspTransport;
      streamType: StreamType;
      fitMode: FitMode;
      label: TileLabel | null;
    }
  | {
      kind: 'placeholder';
      position: number;
      text: string;
      label: TileLabel | null;
    }
  | { kind: 'empty'; position: number };

export interface BuildMosaicOptions {
  grid: { rows: number; cols: number };
  output: {
    width: number;
    height: number;
    fps: number;
    videoBitrateKbps: number;
    gopSeconds: number;
    backgroundColor: string;
  };
  encoder: EncoderId;
  tiles: TileInput[];
  publish: {
    rtspBaseUrl: string;
    slug: string;
    username?: string;
    password?: string;
    transport?: 'tcp' | 'udp';
  };
  resilience: { rtspTimeoutMs: number };
  ffmpeg: { binary: string; logLevel: string; fontFile: string };
  hw?: { vaapiDevice?: string; qsvDevice?: string };
}

export interface BuiltCommand {
  bin: string;
  args: string[];
  /** Shell-ish, credential-redacted rendering for logs / the UI. */
  pretty: string;
  /** ffmpeg input index -> grid position (for stderr attribution). */
  inputIndexToPosition: number[];
  /** ffmpeg input index -> "camera" | "placeholder" | "empty". */
  inputIndexKind: Array<TileInput['kind']>;
  cell: { width: number; height: number };
  canvas: { width: number; height: number };
}

function even(n: number): number {
  return n % 2 === 0 ? n : n - 1;
}

function escapeDrawtext(text: string): string {
  // drawtext is doubly parsed: escape backslash, then filter specials.
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function normalizeColor(c: string): string {
  const trimmed = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return `0x${trimmed.slice(1)}`;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `0x${trimmed}`;
  return trimmed || 'black';
}

function labelXY(pos: LabelPosition, fontSize: number): { x: string; y: string } {
  const pad = Math.round(fontSize * 0.4);
  const left = `${pad}`;
  const right = `w-tw-${pad}`;
  const hcenter = `(w-tw)/2`;
  const top = `${pad}`;
  const bottom = `h-th-${pad}`;
  switch (pos) {
    case 'top-left':
      return { x: left, y: top };
    case 'top-center':
      return { x: hcenter, y: top };
    case 'top-right':
      return { x: right, y: top };
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'bottom-center':
      return { x: hcenter, y: bottom };
    case 'bottom-right':
      return { x: right, y: bottom };
  }
}

function drawtextFilter(
  label: TileLabel,
  fontFile: string,
  opts: { color?: string; extra?: string } = {},
): string {
  const { x, y } = labelXY(label.position, label.fontSize);
  const boxAlpha = Math.max(0, Math.min(1, label.bgOpacity)).toFixed(2);
  const parts = [
    `fontfile='${fontFile}'`,
    `text='${escapeDrawtext(label.text)}'`,
    `fontcolor=${opts.color ?? 'white'}`,
    `fontsize=${label.fontSize}`,
    `x=${x}`,
    `y=${y}`,
    `box=1`,
    `boxcolor=black@${boxAlpha}`,
    `boxborderw=${Math.round(label.fontSize * 0.25)}`,
    `shadowcolor=black@0.6`,
    `shadowx=1`,
    `shadowy=1`,
  ];
  if (opts.extra) parts.push(opts.extra);
  return `drawtext=${parts.join(':')}`;
}

function tileScaleChain(fit: FitMode, w: number, h: number, bg: string): string {
  switch (fit) {
    case 'fill':
      return `scale=${w}:${h},setsar=1`;
    case 'crop':
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
    case 'fit':
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
    case 'letterbox':
    default:
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1`;
  }
}

/** RTSP input flags shared by camera tiles. */
function rtspInputArgs(transport: RtspTransport, timeoutUs: number): string[] {
  const args: string[] = [];
  if (transport === 'tcp') args.push('-rtsp_transport', 'tcp');
  else if (transport === 'udp') args.push('-rtsp_transport', 'udp');
  else args.push('-rtsp_flags', 'prefer_tcp');
  args.push(
    '-timeout',
    String(timeoutUs),
    '-fflags',
    '+genpts+discardcorrupt',
    '-use_wallclock_as_timestamps',
    '1',
    '-analyzeduration',
    '3000000',
    '-probesize',
    '5000000',
    '-thread_queue_size',
    '512',
    '-err_detect',
    'ignore_err',
  );
  return args;
}

function encoderArgs(
  encoder: EncoderId,
  bitrateKbps: number,
  gopFrames: number,
): { pre: string[]; encode: string[]; needsHwUpload: 'vaapi' | 'qsv' | null; pixFmt: string } {
  const k = Math.round(bitrateKbps);
  const buf = k * 2;
  const common = ['-g', String(gopFrames), '-keyint_min', String(gopFrames)];
  switch (encoder) {
    case 'h264_vaapi':
      return {
        pre: [],
        encode: [
          '-c:v',
          'h264_vaapi',
          '-rc_mode',
          'CBR',
          '-b:v',
          `${k}k`,
          '-maxrate',
          `${k}k`,
          '-bf',
          '0',
          ...common,
        ],
        needsHwUpload: 'vaapi',
        pixFmt: 'nv12',
      };
    case 'h264_qsv':
      return {
        pre: [],
        encode: [
          '-c:v',
          'h264_qsv',
          '-b:v',
          `${k}k`,
          '-maxrate',
          `${k}k`,
          '-bufsize',
          `${buf}k`,
          '-look_ahead',
          '0',
          '-bf',
          '0',
          ...common,
        ],
        needsHwUpload: 'qsv',
        pixFmt: 'nv12',
      };
    case 'h264_nvenc':
      return {
        pre: [],
        encode: [
          '-c:v',
          'h264_nvenc',
          '-preset',
          'p4',
          '-tune',
          'll',
          '-rc',
          'cbr',
          '-b:v',
          `${k}k`,
          '-maxrate',
          `${k}k`,
          '-bufsize',
          `${buf}k`,
          '-bf',
          '0',
          ...common,
        ],
        needsHwUpload: null,
        pixFmt: 'yuv420p',
      };
    case 'libx264':
    default:
      return {
        pre: [],
        encode: [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-profile:v',
          'high',
          '-sc_threshold',
          '0',
          '-b:v',
          `${k}k`,
          '-maxrate',
          `${k}k`,
          '-bufsize',
          `${buf}k`,
          '-bf',
          '0',
          ...common,
        ],
        needsHwUpload: null,
        pixFmt: 'yuv420p',
      };
  }
}

export function buildMosaicCommand(opts: BuildMosaicOptions): BuiltCommand {
  const { rows, cols } = opts.grid;
  const capacity = rows * cols;
  const bg = normalizeColor(opts.output.backgroundColor);
  const fps = opts.output.fps;
  const timeoutUs = Math.max(1_000_000, Math.round(opts.resilience.rtspTimeoutMs * 1000));

  const cellW = Math.max(2, even(Math.floor(opts.output.width / cols)));
  const cellH = Math.max(2, even(Math.floor(opts.output.height / rows)));
  const canvasW = cellW * cols;
  const canvasH = cellH * rows;
  const outW = even(opts.output.width);
  const outH = even(opts.output.height);

  // Expand provided tiles into a full row-major grid (missing -> empty).
  const byPosition = new Map<number, TileInput>();
  for (const t of opts.tiles) {
    if (t.position >= 0 && t.position < capacity) byPosition.set(t.position, t);
  }
  const grid: TileInput[] = [];
  for (let p = 0; p < capacity; p++) {
    grid.push(byPosition.get(p) ?? { kind: 'empty', position: p });
  }

  const args: string[] = [
    '-hide_banner',
    '-loglevel',
    `level+${opts.ffmpeg.logLevel}`,
    '-nostdin',
    '-nostats',
    '-progress',
    'pipe:1',
    '-stats_period',
    '1',
  ];

  // Hardware device init (must precede inputs).
  if (opts.encoder === 'h264_vaapi') {
    args.push('-vaapi_device', opts.hw?.vaapiDevice ?? '/dev/dri/renderD128');
  } else if (opts.encoder === 'h264_qsv') {
    args.push(
      '-init_hw_device',
      `qsv=hw${opts.hw?.qsvDevice ? `:${opts.hw.qsvDevice}` : ''}`,
      '-filter_hw_device',
      'hw',
    );
  }

  const inputIndexToPosition: number[] = [];
  const inputIndexKind: Array<TileInput['kind']> = [];
  const filterChains: string[] = [];
  const xstackLabels: string[] = [];
  const layoutEntries: string[] = [];

  grid.forEach((tile, gridIndex) => {
    const inputIndex = inputIndexToPosition.length;
    const col = gridIndex % cols;
    const row = Math.floor(gridIndex / cols);
    layoutEntries.push(`${col * cellW}_${row * cellH}`);

    if (tile.kind === 'camera') {
      args.push(...rtspInputArgs(tile.transport, timeoutUs));
      args.push('-i', withCredentials(tile.rtspUrl, tile.username, tile.password));
    } else if (tile.kind === 'placeholder') {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `color=c=0x1a1a1a:s=${cellW}x${cellH}:r=${fps}`,
      );
    } else {
      args.push('-f', 'lavfi', '-i', `color=c=${bg}:s=${cellW}x${cellH}:r=${fps}`);
    }
    inputIndexToPosition.push(tile.position);
    inputIndexKind.push(tile.kind);

    // Per-tile filter chain -> [vN], always cellW x cellH, cfr fps, sar 1.
    // Filters are comma-joined; the input pad label is a PREFIX (no comma).
    const filters: string[] = [];
    if (tile.kind === 'camera') {
      filters.push(tileScaleChain(tile.fitMode, cellW, cellH, bg));
      filters.push(`fps=${fps}`);
      if (tile.label && tile.label.text.trim()) {
        filters.push(drawtextFilter(tile.label, opts.ffmpeg.fontFile));
      }
    } else if (tile.kind === 'placeholder') {
      filters.push('setsar=1');
      const offlineLabel: TileLabel = {
        text: tile.text,
        position: 'bottom-center',
        fontSize: Math.max(14, Math.round(cellH / 12)),
        bgOpacity: 0,
      };
      filters.push(
        drawtextFilter(offlineLabel, opts.ffmpeg.fontFile, {
          color: '#ff6b6b',
          extra: `x=(w-tw)/2:y=(h-th)/2`,
        }),
      );
      if (tile.label && tile.label.text.trim()) {
        filters.push(drawtextFilter(tile.label, opts.ffmpeg.fontFile));
      }
    } else {
      filters.push('setsar=1');
    }
    const outLabel = `v${inputIndex}`;
    filterChains.push(`[${inputIndex}:v]${filters.join(',')}[${outLabel}]`);
    xstackLabels.push(`[${outLabel}]`);
  });

  const n = xstackLabels.length;
  let graph = filterChains.join(';');
  if (n === 1) {
    graph += `;${xstackLabels[0]}null[grid]`;
  } else {
    graph += `;${xstackLabels.join('')}xstack=inputs=${n}:layout=${layoutEntries.join('|')}:fill=${bg}[grid]`;
  }

  const enc = encoderArgs(opts.encoder, opts.output.videoBitrateKbps, Math.max(1, Math.round(opts.output.gopSeconds * fps)));
  let finalize = `[grid]pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=${bg}`;
  if (enc.needsHwUpload === 'vaapi') finalize += `,format=nv12,hwupload`;
  else if (enc.needsHwUpload === 'qsv') finalize += `,format=nv12,hwupload=extra_hw_frames=64`;
  else finalize += `,format=${enc.pixFmt}`;
  finalize += `[vout]`;
  graph += `;${finalize}`;

  args.push('-filter_complex', graph, '-map', '[vout]', '-an');
  args.push(...enc.pre, ...enc.encode);
  args.push('-fps_mode', 'cfr', '-r', String(fps), '-muxdelay', '0');

  const outTransport = opts.publish.transport ?? 'tcp';
  const publishUrl = withCredentials(
    `${opts.publish.rtspBaseUrl.replace(/\/+$/, '')}/${opts.publish.slug}`,
    opts.publish.username,
    opts.publish.password,
  );
  args.push('-f', 'rtsp', '-rtsp_transport', outTransport, publishUrl);

  const pretty = redactText(
    `${opts.ffmpeg.binary} ${args
      .map((a) => (/[\s'"\\|]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a))
      .join(' ')}`,
  );

  return {
    bin: opts.ffmpeg.binary,
    args,
    pretty,
    inputIndexToPosition,
    inputIndexKind,
    cell: { width: cellW, height: cellH },
    canvas: { width: canvasW, height: canvasH },
  };
}
