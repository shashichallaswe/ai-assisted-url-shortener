import { CLICK_TEXT_LIMIT } from './constants.js';

export function truncate(value: string | undefined, max = CLICK_TEXT_LIMIT): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  return value.length <= max ? value : value.slice(0, max);
}
