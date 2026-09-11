import { pino, type Logger } from 'pino';
import { redactText } from 'shared';
import { loadEnv } from './env.js';

/**
 * Structured JSON logger. Every message passes through a redaction hook so that
 * RTSP URLs with credentials and anything password-shaped never reach disk.
 */
const REDACT_PATHS = [
  'password',
  'pass',
  'encryptedPassword',
  '*.password',
  '*.pass',
  'req.headers.authorization',
  'headers.authorization',
];

let rootLogger: Logger | undefined;

export function getLogger(): Logger {
  if (rootLogger) return rootLogger;
  const env = loadEnv();

  rootLogger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'camera-mosaic' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '***' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    hooks: {
      logMethod(inputArgs, method) {
        // Scrub credential-shaped substrings from the free-text message.
        const args = inputArgs.slice() as unknown[];
        for (let i = 0; i < args.length; i++) {
          if (typeof args[i] === 'string') args[i] = redactText(args[i] as string);
        }
        return method.apply(this, args as Parameters<typeof method>);
      },
    },
    transport:
      env.LOG_PRETTY || (env.NODE_ENV === 'development' && process.stdout.isTTY)
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
          }
        : undefined,
  });
  return rootLogger;
}

export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}
