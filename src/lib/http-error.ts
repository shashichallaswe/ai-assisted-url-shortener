export interface FieldError {
  field: string;
  message: string;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: readonly FieldError[];
  readonly retryAfterSeconds?: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: readonly FieldError[],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized', 'Unauthorized');
}

export function notFound(): HttpError {
  return new HttpError(404, 'not_found', 'Not found');
}

export function tooManyRequests(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'rate_limited', 'Too many requests', undefined, retryAfterSeconds);
}
