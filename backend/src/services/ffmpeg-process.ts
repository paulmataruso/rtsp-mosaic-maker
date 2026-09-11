import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { redactText } from 'shared';

type FfmpegChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Supervises exactly one FFmpeg child process:
 *  - parses `-progress pipe:1` key/value blocks from stdout into metrics
 *  - line-buffers stderr, classifies lines, and attributes input errors to a
 *    grid position via the `inputIndexToPosition` map
 *  - guarantees the child is reaped on stop (SIGTERM -> grace -> SIGKILL)
 *
 * It does NOT decide when to restart — that is the FfmpegManager's job.
 */

export interface FfmpegProgress {
  frame: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  outTimeSec: number | null;
  dropFrames: number | null;
  dupFrames: number | null;
  speed: number | null;
}

export interface FfmpegExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Best-effort human explanation derived from the last stderr lines. */
  reason: string;
  /** Grid positions whose input appeared to be the cause, if any. */
  culpritPositions: number[];
  durationMs: number;
}

export interface FfmpegProcessOptions {
  bin: string;
  args: string[];
  /** ffmpeg input index -> grid position (from the command builder). */
  inputIndexToPosition: number[];
  /** For log tagging. */
  mosaicId: string;
  slug: string;
  /** Redacted command string for the boot log line. */
  pretty: string;
}

type Events = {
  progress: [FfmpegProgress];
  stderr: [{ line: string; level: 'info' | 'warn' | 'error' }];
  'input-error': [{ position: number; message: string }];
  exit: [FfmpegExit];
};

const FATAL_HINTS: Array<{ re: RegExp; reason: string }> = [
  // Ordered most-specific first.
  { re: /No such filter|Filter not found|Error (parsing|initializing) (a )?filter|Cannot create the link/i, reason: 'internal error building the FFmpeg filter graph — please report this' },
  { re: /Unknown encoder|Encoder .* not found|Automatic encoder selection failed/i, reason: 'the selected encoder is not available in this FFmpeg build' },
  { re: /Cannot load|Failed to initiali[sz]e|InitializeEncoder failed|No VA display|vaapi.*Failed|Device creation failed/i, reason: 'hardware encoder / GPU device could not be initialised' },
  { re: /401 Unauthorized|Authorization failed|403 Forbidden|method DESCRIBE failed: 401/i, reason: 'RTSP authentication failed' },
  { re: /Connection refused/i, reason: 'connection refused by the camera' },
  { re: /No route to host|Network is unreachable/i, reason: 'camera network unreachable' },
  { re: /Connection timed out|Operation timed out|timed out!/i, reason: 'RTSP connection timed out' },
  { re: /404 Not Found|method DESCRIBE failed: 404/i, reason: 'RTSP stream path not found on the camera' },
  { re: /Server returned 5\d\d/i, reason: 'camera RTSP server error' },
  { re: /Invalid data found when processing input|could not find codec parameters/i, reason: 'invalid or unsupported stream data from a camera' },
  { re: /Immediate exit requested/i, reason: 'stopped' },
  { re: /Conversion failed/i, reason: 'FFmpeg conversion failed' },
];

export class FfmpegProcess extends EventEmitter {
  private child: FfmpegChild | undefined;
  private readonly opts: FfmpegProcessOptions;
  private stderrTail: string[] = [];
  private progressAccu: Record<string, string> = {};
  private startedAt = 0;
  private stopping = false;
  private killTimer: NodeJS.Timeout | undefined;

  constructor(opts: FfmpegProcessOptions) {
    super();
    this.opts = opts;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get running(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  get uptimeMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  // Typed emit/on overloads.
  override emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }

  start(): void {
    if (this.child) throw new Error('FfmpegProcess already started');
    this.startedAt = Date.now();
    this.child = spawn(this.opts.bin, this.opts.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    }) as FfmpegChild;

    const rlOut = createInterface({ input: this.child.stdout });
    rlOut.on('line', (line) => this.handleProgressLine(line));

    const rlErr = createInterface({ input: this.child.stderr });
    rlErr.on('line', (line) => this.handleStderrLine(line));

    this.child.on('error', (err) => {
      this.finish(null, null, `failed to spawn ffmpeg: ${err.message}`);
    });
    this.child.on('exit', (code, signal) => {
      this.finish(code, signal);
    });
  }

  private handleProgressLine(line: string): void {
    const eq = line.indexOf('=');
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'progress') {
      this.emit('progress', this.snapshotProgress());
      this.progressAccu = {};
    } else {
      this.progressAccu[key] = value;
    }
  }

  private snapshotProgress(): FfmpegProgress {
    const a = this.progressAccu;
    const num = (v: string | undefined): number | null => {
      if (v === undefined || v === 'N/A') return null;
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : null;
    };
    const bitrateRaw = a['bitrate']; // e.g. "8123.4kbits/s"
    const bitrateKbps = bitrateRaw ? num(bitrateRaw.replace(/kbits\/s$/i, '')) : null;
    const outTimeUs = num(a['out_time_us'] ?? a['out_time_ms']);
    const speedRaw = a['speed']; // e.g. "1.01x"
    return {
      frame: num(a['frame']),
      fps: num(a['fps']),
      bitrateKbps,
      outTimeSec: outTimeUs !== null ? outTimeUs / 1_000_000 : null,
      dropFrames: num(a['drop_frames']),
      dupFrames: num(a['dup_frames']),
      speed: speedRaw ? num(speedRaw.replace(/x$/i, '')) : null,
    };
  }

  private handleStderrLine(raw: string): void {
    const line = redactText(raw);
    this.stderrTail.push(line);
    if (this.stderrTail.length > 60) this.stderrTail.shift();

    let level: 'info' | 'warn' | 'error' = 'info';
    if (/\berror\b|\bfailed\b|\bunable\b|Immediate exit/i.test(line)) level = 'error';
    else if (/\bwarning\b|deprecated|retry/i.test(line)) level = 'warn';
    this.emit('stderr', { line, level });

    // Attribute "Error ... http://.. / Last message repeated" style lines to a
    // specific input when ffmpeg prints the offending URL/index.
    const idxMatch =
      line.match(/Input #(\d+)/i) ??
      line.match(/stream (\d+):/i) ??
      line.match(/\[.*?@ .*?\]\s.*?input (\d+)/i);
    if (level === 'error' && idxMatch) {
      const inputIdx = Number.parseInt(idxMatch[1]!, 10);
      const pos = this.opts.inputIndexToPosition[inputIdx];
      if (pos !== undefined) this.emit('input-error', { position: pos, message: line });
    }
  }

  private classifyReason(code: number | null, signal: NodeJS.Signals | null): string {
    if (this.stopping || signal === 'SIGTERM' || signal === 'SIGKILL') return 'stopped';
    const tail = this.stderrTail.join('\n');
    for (const hint of FATAL_HINTS) {
      if (hint.re.test(tail)) return hint.reason;
    }
    if (code === 0) return 'ffmpeg exited cleanly (input ended)';
    return `ffmpeg exited with code ${code ?? 'null'}`;
  }

  private guessCulpritPositions(): number[] {
    const tail = this.stderrTail.join('\n');
    const positions = new Set<number>();
    for (const m of tail.matchAll(/Input #(\d+)/gi)) {
      const pos = this.opts.inputIndexToPosition[Number.parseInt(m[1]!, 10)];
      if (pos !== undefined) positions.add(pos);
    }
    return [...positions];
  }

  private finish(code: number | null, signal: NodeJS.Signals | null, spawnError?: string): void {
    if (this.killTimer) clearTimeout(this.killTimer);
    const reason = spawnError ?? this.classifyReason(code, signal);
    const exit: FfmpegExit = {
      code,
      signal,
      reason,
      culpritPositions: reason === 'stopped' ? [] : this.guessCulpritPositions(),
      durationMs: this.uptimeMs,
    };
    this.child = undefined;
    this.emit('exit', exit);
  }

  /** Recent stderr for diagnostics (already redacted). */
  stderrSnapshot(): string[] {
    return [...this.stderrTail];
  }

  /** Graceful stop: SIGTERM, then SIGKILL after `graceMs`. */
  async stop(graceMs = 5000): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    const child = this.child;
    await new Promise<void>((resolve) => {
      const onExit = (): void => resolve();
      child.once('exit', onExit);
      try {
        child.kill('SIGTERM');
      } catch {
        resolve();
        return;
      }
      this.killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, graceMs);
    });
    if (this.killTimer) clearTimeout(this.killTimer);
  }
}
