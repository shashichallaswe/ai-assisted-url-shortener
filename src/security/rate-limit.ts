import { createHash } from 'node:crypto';
import { tooManyRequests } from '../lib/http-error.js';

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision>;
}

export interface RateLimitConfig {
  createMax: number;
  createWindowSeconds: number;
  redirectMax: number;
  redirectWindowSeconds: number;
  ipPepper: string;
}

export function rateLimitIpDigest(ip: string, pepper: string): string {
  return createHash('sha256').update(`rl:${pepper}:${ip}`, 'utf8').digest('hex').slice(0, 32);
}

export function rateLimitWindowStart(now: Date, windowSeconds: number): number {
  return Math.floor(now.getTime() / 1000 / windowSeconds) * windowSeconds;
}

export function rateLimitKey(kind: 'create' | 'redirect', id: string, windowStart: number): string {
  return `rl:${kind}:v1:${id}:${String(windowStart)}`;
}

export async function enforceRateLimit(
  limiter: RateLimiter,
  kind: 'create' | 'redirect',
  id: string,
  limit: number,
  windowSeconds: number,
  now: Date,
): Promise<void> {
  const key = rateLimitKey(kind, id, rateLimitWindowStart(now, windowSeconds));
  const decision = await limiter.consume(key, limit, windowSeconds);
  if (!decision.allowed) {
    throw tooManyRequests(decision.retryAfterSeconds);
  }
}

export function remainingWindowSeconds(now: Date, windowSeconds: number): number {
  const start = rateLimitWindowStart(now, windowSeconds);
  const elapsed = Math.floor(now.getTime() / 1000) - start;
  return Math.max(1, windowSeconds - elapsed);
}
