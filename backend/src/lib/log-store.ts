import type { LogEntry, LogSource, LogLevel, LogQuery } from 'shared';
import { redactText } from 'shared';
import { bus } from './event-bus.js';
import { getLogger } from '../config/logger.js';

/**
 * In-memory ring buffer of recent structured log lines for the Logs page.
 * Every entry is also mirrored to the pino logger and broadcast on the bus
 * so WebSocket clients get it live. Nothing here is persisted to disk beyond
 * pino's own stdout stream (which the container runtime captures).
 */
const CAPACITY = 5000;

class LogStore {
  private readonly buffer: LogEntry[] = [];
  private readonly pino = getLogger().child({ component: 'app' });

  push(
    level: LogLevel,
    source: LogSource,
    message: string,
    ctx: { mosaicId?: string | null; cameraId?: string | null; slug?: string | null } = {},
  ): LogEntry {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      source,
      message: redactText(message),
      mosaicId: ctx.mosaicId ?? null,
      cameraId: ctx.cameraId ?? null,
      slug: ctx.slug ?? null,
    };
    this.buffer.push(entry);
    if (this.buffer.length > CAPACITY) this.buffer.splice(0, this.buffer.length - CAPACITY);

    // Mirror into pino (structured, redaction applied again defensively).
    const pinoLevel = level === 'fatal' ? 'fatal' : level;
    this.pino[pinoLevel]?.(
      { source, mosaicId: entry.mosaicId, cameraId: entry.cameraId, slug: entry.slug },
      entry.message,
    );

    bus.emit('log', entry);
    return entry;
  }

  query(q: LogQuery): LogEntry[] {
    const limit = q.limit ?? 500;
    const sinceMs = q.since ? Date.parse(q.since) : undefined;
    const out: LogEntry[] = [];
    for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.buffer[i]!;
      if (q.source && e.source !== q.source) continue;
      if (q.level && e.level !== q.level) continue;
      if (q.mosaicId && e.mosaicId !== q.mosaicId) continue;
      if (q.cameraId && e.cameraId !== q.cameraId) continue;
      if (sinceMs !== undefined && Date.parse(e.ts) <= sinceMs) continue;
      out.push(e);
    }
    return out.reverse();
  }
}

export const logStore = new LogStore();

/** Convenience helpers used across services. */
export const appLog = {
  debug: (m: string, ctx?: Parameters<LogStore['push']>[3]) => logStore.push('debug', 'app', m, ctx),
  info: (m: string, ctx?: Parameters<LogStore['push']>[3]) => logStore.push('info', 'app', m, ctx),
  warn: (m: string, ctx?: Parameters<LogStore['push']>[3]) => logStore.push('warn', 'app', m, ctx),
  error: (m: string, ctx?: Parameters<LogStore['push']>[3]) => logStore.push('error', 'app', m, ctx),
};
