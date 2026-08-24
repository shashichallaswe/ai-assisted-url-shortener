import { utcDay } from '../lib/ip-hash.js';
import type { ClickCounters } from './click-counters.js';

export class MemoryClickCounters implements ClickCounters {
  private readonly totals = new Map<string, number>();
  private readonly days = new Map<string, number>();

  increment(code: string, at: Date): Promise<void> {
    this.totals.set(code, (this.totals.get(code) ?? 0) + 1);
    const dayKey = `${code}:${utcDay(at)}`;
    this.days.set(dayKey, (this.days.get(dayKey) ?? 0) + 1);
    return Promise.resolve();
  }

  total(code: string): number {
    return this.totals.get(code) ?? 0;
  }

  day(code: string, at: Date): number {
    return this.days.get(`${code}:${utcDay(at)}`) ?? 0;
  }
}
