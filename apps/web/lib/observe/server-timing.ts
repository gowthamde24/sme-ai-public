import { cache } from "react";

import { epochMs, serverTimingOn } from "./timing-format";

/**
 * A request-scoped collector of named spans (C2, 19 Nov 2026, "where does the first byte go?"). Behind SERVER_TIMING=1; with the switch off `timed` just returns what `run` returns and `mark` does nothing.
 * The collector lives in React's per-request `cache` (the same device as lib/api/request-memo.ts): every Server Component of ONE render sees the same one; outside a request it remembers nothing, so tests and client code are untouched.
 * A response header cannot be set once streaming has started, so the spans of the render are NOT a header: `ServerTimingReport` (at the end of the stream) reads them, once the render's own reads have finished. The proxy's part is a real header (proxy.ts).
 * Numbers and fixed names only.
 */
export type Span = { /** the span's name (fixed words of ours) */ n: string; /** start, ms since 1970 */ s: number; /** duration in ms (0 for a mark) */ d: number };

type Slot = { spans: Span[]; pending: Set<Promise<unknown>>; started: number };
const slot = cache((): Slot => ({ spans: [], pending: new Set(), started: 0 }));

/** Runs `run`, and when the switch is on records how long it took (also when it throws: the span is kept and the error goes on). The name is fixed words of ours (timing-format.ts SPAN_NAME). */
export function timed<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!serverTimingOn()) return run();
  const s = slot();
  const start = epochMs();
  s.started += 1;
  let ask: Promise<T>;
  try {
    ask = run();
  } catch (error) {
    ask = Promise.reject(error);
  }
  const record = () => {
    s.spans.push({ n: name, s: start, d: epochMs() - start });
  };
  const tracked = ask.then(
    (value) => {
      record();
      return value;
    },
    (error: unknown) => {
      record();
      throw error;
    },
  );
  const watch = tracked.then(
    () => undefined,
    () => undefined,
  );
  s.pending.add(watch);
  void watch.then(() => s.pending.delete(watch));
  return tracked;
}

/** A point in time ("the layout is done"): a span of no length. */
export function mark(name: string): void {
  if (!serverTimingOn()) return;
  const s = slot();
  s.started += 1;
  s.spans.push({ n: name, s: epochMs(), d: 0 });
}

/**
 * Waits until the render has gone quiet: at least one span was started, none is running, and none was started for `quietMs`; never longer than `maxMs`. (A response cannot say "I am done" to a component that sits in it, so quiet is the signal.)
 * Returns the spans recorded so far, oldest first.
 */
export async function settled(quietMs = 300, maxMs = 8000): Promise<Span[]> {
  const s = slot();
  const end = epochMs() + maxMs;
  let seen = -1;
  while (epochMs() < end) {
    while (s.pending.size > 0 && epochMs() < end) await Promise.race([Promise.all([...s.pending]), new Promise((r) => setTimeout(r, 100))]);
    if (s.started > 0 && s.started === seen && s.pending.size === 0) break;
    seen = s.started;
    await new Promise((r) => setTimeout(r, quietMs));
  }
  return [...s.spans].sort((a, b) => a.s - b.s);
}
