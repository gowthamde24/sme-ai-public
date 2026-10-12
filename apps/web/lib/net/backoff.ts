/**
 * Waiting between tries (job BW): exponential, capped, with a little jitter so many tabs do not come back at the same second. Pure: the random number is an argument.
 * attempt 0 = the wait after the first failure.
 */
export function backoffDelay(attempt: number, opts: { base?: number; cap?: number } = {}, random: number = Math.random()): number {
  const base = opts.base ?? 1000;
  const cap = opts.cap ?? 30_000;
  const raw = Math.min(cap, base * 2 ** Math.max(0, attempt));
  return Math.round(raw * (0.85 + 0.3 * random));
}

export interface RetryOptions {
  /** Tries in all, the first included. */
  tries?: number;
  base?: number;
  cap?: number;
  signal?: AbortSignal;
  /** Whether a failure is worth another try (default: any failure but an abort). */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))), { once: true });
  });

/** Runs `run` again after a growing wait when it fails; for a read that can be asked twice, never for a send. The last failure is thrown. */
export async function retryWithBackoff<T>(run: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const tries = Math.max(1, opts.tries ?? 3);
  const sleep = opts.sleep ?? sleepFor;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      const aborted = (error as { name?: string })?.name === "AbortError" || opts.signal?.aborted;
      if (aborted || attempt + 1 >= tries || (opts.shouldRetry && !opts.shouldRetry(error, attempt))) throw error;
      await sleep(backoffDelay(attempt, opts, opts.random?.() ?? Math.random()), opts.signal);
    }
  }
}
