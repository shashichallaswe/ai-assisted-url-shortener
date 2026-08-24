import { randomBytes } from 'node:crypto';

export const CODE_LENGTH = 7;
export const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const ALPHABET_SIZE = CODE_ALPHABET.length;
const REJECTION_CEILING = 256 - (256 % ALPHABET_SIZE);

export function generateShortCode(): string {
  for (;;) {
    const code = generateRawCode();
    if (!isReservedCode(code)) {
      return code;
    }
  }
}

function generateRawCode(): string {
  const chars: string[] = [];

  while (chars.length < CODE_LENGTH) {
    const bytes = randomBytes(CODE_LENGTH);
    for (const byte of bytes) {
      if (byte >= REJECTION_CEILING) {
        continue;
      }
      const index = byte % ALPHABET_SIZE;
      const char = CODE_ALPHABET[index];
      if (char === undefined) {
        continue;
      }
      chars.push(char);
      if (chars.length === CODE_LENGTH) {
        break;
      }
    }
  }

  return chars.join('');
}

export function isWellFormedCode(value: string): boolean {
  return /^[0-9A-Za-z]{7}$/u.test(value);
}

const RESERVED_CODES = new Set(['health', 'ready', 'api', 'openapi', 'favicon']);

/**
 * Path segments that must never be resolved as short codes, even when they
 * happen to be 7 characters of base62 (`openapi`, `favicon`).
 */
export function isReservedCode(value: string): boolean {
  return RESERVED_CODES.has(value.toLowerCase());
}
