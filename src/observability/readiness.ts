export type DependencyState = 'ok' | 'down';

export interface ReadinessReport {
  ready: boolean;
  postgres: DependencyState;
  redis: DependencyState;
}

export interface ReadinessProbes {
  postgres?: () => Promise<void>;
  redis?: () => Promise<void>;
}

const PROBE_TIMEOUT_MS = 1_000;

export async function checkReadiness(probes: ReadinessProbes): Promise<ReadinessReport> {
  const [postgres, redis] = await Promise.all([
    probe('postgres', probes.postgres),
    probe('redis', probes.redis),
  ]);
  return { ready: postgres === 'ok' && redis === 'ok', postgres, redis };
}

async function probe(
  _name: string,
  fn: (() => Promise<void>) | undefined,
): Promise<DependencyState> {
  if (fn === undefined) {
    return 'down';
  }
  try {
    await withTimeout(fn, PROBE_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'down';
  }
}

function withTimeout(fn: () => Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('probe timed out'));
    }, ms);
    fn().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
