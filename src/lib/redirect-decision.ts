export interface RedirectCandidate {
  destinationUrl: string;
  expiresAt: Date | null;
  deletedAt: Date | null;
}

export type RedirectDecision = { ok: true; destinationUrl: string } | { ok: false };

/**
 * Guards re-evaluated on every request, including cache hits. Expiry is a
 * timestamp, not an event: a cached entry whose expiresAt has passed must 404
 * even if Redis has not yet dropped it.
 */
export function redirectDecision(candidate: RedirectCandidate, now: Date): RedirectDecision {
  if (candidate.deletedAt !== null) {
    return { ok: false };
  }
  if (candidate.expiresAt !== null && candidate.expiresAt.getTime() <= now.getTime()) {
    return { ok: false };
  }
  return { ok: true, destinationUrl: candidate.destinationUrl };
}
