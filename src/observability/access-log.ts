export interface AccessLogFields {
  reqId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

export function accessLogFields(input: AccessLogFields): AccessLogFields {
  return {
    reqId: input.reqId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    durationMs: input.durationMs,
  };
}
