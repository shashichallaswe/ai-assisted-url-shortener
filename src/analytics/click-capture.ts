import type { ClickCounters } from '../cache/click-counters.js';
import { MAX_CLICK_QUEUE } from '../lib/constants.js';
import { hashIp } from '../lib/ip-hash.js';
import { truncate } from '../lib/truncate.js';
import type { DurableClick } from '../repos/click-events.js';

export interface ClickInput {
  urlId: string;
  code: string;
  ip: string;
  userAgent: string | undefined;
  referrer: string | undefined;
  at: Date;
}

export interface ClickCaptureDeps {
  salt: string;
  clock: () => Date;
  counters: ClickCounters;
  insert: (rows: DurableClick[]) => Promise<void>;
  onError: (error: unknown) => void;
  maxQueue?: number;
}

/**
 * Fire-and-forget click recording. `record` never throws and never awaits I/O,
 * so the redirect handler can call it and still return 302. A crash before
 * `flush` drops the buffer (at-most-once).
 */
export class ClickCapture {
  private queue: DurableClick[] = [];
  private inflight: Promise<void>[] = [];
  dropped = 0;
  private readonly maxQueue: number;

  constructor(private readonly deps: ClickCaptureDeps) {
    this.maxQueue = deps.maxQueue ?? MAX_CLICK_QUEUE;
  }

  record(input: ClickInput): void {
    try {
      const row = this.normalize(input);
      if (this.queue.length >= this.maxQueue) {
        this.queue.shift();
        this.dropped += 1;
      }
      this.queue.push(row);
      this.inflight.push(
        Promise.resolve(this.deps.counters.increment(input.code, input.at)).catch(
          (error: unknown) => {
            this.deps.onError(error);
          },
        ),
      );
    } catch (error) {
      this.deps.onError(error);
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.inflight);
    this.inflight = [];
    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) {
      return;
    }
    try {
      await this.deps.insert(batch);
    } catch (error) {
      this.deps.onError(error);
    }
  }

  private normalize(input: ClickInput): DurableClick {
    return {
      urlId: input.urlId,
      clickedAt: input.at,
      ipHash: hashIp(input.ip, this.deps.salt, input.at),
      userAgent: truncate(input.userAgent),
      referrer: truncate(input.referrer),
    };
  }
}
