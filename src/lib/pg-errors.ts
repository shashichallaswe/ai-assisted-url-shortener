export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('code' in error) || !('constraint' in error)) {
    return false;
  }
  return error.code === '23505' && error.constraint === constraint;
}
