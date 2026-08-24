/**
 * Fastify's default request serializer includes `remoteAddress`. AGENTS.md
 * forbids logging raw client IP addresses, so these serializers replace it
 * rather than relying on redaction after the fact.
 *
 * The parameter types are structural on purpose: only these fields are read,
 * and binding to Fastify's request and reply generics buys nothing here.
 */

export interface LoggableRequest {
  id: string;
  method: string;
  url: string;
  ip?: string;
  hostname?: string;
}

export interface LoggableReply {
  statusCode: number;
}

export function serializeRequest(request: LoggableRequest): {
  id: string;
  method: string;
  url: string;
} {
  return { id: request.id, method: request.method, url: request.url };
}

export function serializeReply(reply: LoggableReply): { statusCode: number } {
  return { statusCode: reply.statusCode };
}

export function createLoggerOptions(level = process.env.LOG_LEVEL ?? 'info') {
  return {
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      remove: true,
    },
    serializers: {
      req: serializeRequest,
      res: serializeReply,
    },
  };
}

/** Snapshot used by unit tests that assert redaction paths. */
export const loggerOptions = createLoggerOptions();
