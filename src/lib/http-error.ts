export interface FieldError {
  field: string;
  message: string;
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: readonly FieldError[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: readonly FieldError[],
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized', 'Unauthorized');
}
