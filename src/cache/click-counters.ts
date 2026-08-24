export interface ClickCounters {
  increment(code: string, at: Date): Promise<void>;
  total(code: string): number | Promise<number>;
}
