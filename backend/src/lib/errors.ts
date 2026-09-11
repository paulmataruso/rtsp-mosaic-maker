/**
 * Application error taxonomy. `AppError` is the only class; the named helpers
 * are factory functions (call them WITHOUT `new`). Every AppError maps to a
 * stable HTTP status + machine code + human message. The Fastify error handler
 * (app.ts) turns anything else into a 500 without leaking internals.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    opts: { details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = opts.details;
    this.expose = opts.expose ?? statusCode < 500;
  }
}

export function NotFound(what: string, id?: string): AppError {
  return new AppError(
    404,
    'not_found',
    id ? `${what} "${id}" was not found.` : `${what} was not found.`,
  );
}

export function BadRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'bad_request', message, { details });
}

export function Conflict(message: string, details?: unknown): AppError {
  return new AppError(409, 'conflict', message, { details });
}

export function Unauthorized(message = 'Authentication required.'): AppError {
  return new AppError(401, 'unauthorized', message);
}

export function Forbidden(message = 'Not permitted.'): AppError {
  return new AppError(403, 'forbidden', message);
}

export function UpstreamError(message: string, details?: unknown): AppError {
  return new AppError(502, 'upstream_error', message, { details, expose: true });
}

export function PreconditionFailed(message: string, details?: unknown): AppError {
  return new AppError(412, 'precondition_failed', message, { details });
}

export function ResourceLimit(message: string, details?: unknown): AppError {
  return new AppError(422, 'resource_limit', message, { details });
}
