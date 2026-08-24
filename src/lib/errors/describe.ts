/**
 * Turns an unknown thrown value into something worth printing.
 *
 * `pg` reports an unreachable host as an AggregateError whose own message is
 * empty, so the naive `error.message` produces a blank line at exactly the
 * moment an operator needs detail.
 */
export function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = error.errors.map((inner) => describeError(inner)).filter(Boolean);

    if (causes.length > 0) {
      return causes.join('; ');
    }

    return error.message || 'AggregateError';
  }

  if (error instanceof Error) {
    return error.message || error.constructor.name;
  }

  return String(error);
}
