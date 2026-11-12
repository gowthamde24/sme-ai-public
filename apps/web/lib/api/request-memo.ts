import { cache } from "react";

/**
 * One read per request (C1 + C2, 12 Nov 2026, after the staging request log showed ONE Today render asking the same route up to five times: the workspace `tenant` x5, `billing/access` x2, `assistant/activity` x2, `outbox/messages` x2 ...):
 * while the workspace's layout or the Today page has ACTIVATED it for this request, an identical GET (same person, same path and query) is asked of the API once; every other asker gets a copy of the same answer, also one that asks at the same moment.
 * Behind REQUEST_MEMO=1 (off by default). It remembers nothing across requests (React `cache` is per request; outside a request it remembers nothing at all, so tests and client code are untouched), it is switched on only by a RENDER (a route handler, a poll or
 * a server action that has not rendered a layout yet never uses it, so a write is never followed by a stale read), any write through `apiRequest` forgets everything, a read that failed is never kept, and every asker gets its own copy (no one can change what another reads).
 * SERVER ONLY: client.ts reaches this file through a lazy import behind `typeof window === "undefined"`, so no browser ever loads it.
 */
type Slot = { on: boolean; reads: Map<string, Promise<unknown>> };
const slot = cache((): Slot => ({ on: false, reads: new Map() }));

export const requestMemoOn = (): boolean => process.env.REQUEST_MEMO === "1";

/** Called by a RENDER (the workspace layout, the Today page), as early as it can: from now on identical reads of this request are asked once. Does nothing when REQUEST_MEMO is off. */
export function activateRequestMemo(): void {
  if (requestMemoOn()) slot().on = true;
}

/** `run` is the ordinary ask. Not activated: asked as always. A write forgets what was read. A read is asked once per person and address; the others wait for the same ask and get a copy. */
export async function memoRequest(path: string, accessToken: string, init: RequestInit, run: () => Promise<unknown>): Promise<unknown> {
  const s = slot();
  if (!s.on) return run();
  if (init.method !== undefined && init.method !== "GET") {
    s.reads.clear();
    return run();
  }
  const key = `${accessToken}\n${path}`;
  let ask = s.reads.get(key);
  if (!ask) {
    const mine = run();
    ask = mine;
    s.reads.set(key, mine);
    mine.catch(() => {
      if (s.reads.get(key) === mine) s.reads.delete(key); // (a failure is asked again by the next one who needs it)
    });
  }
  return structuredClone(await ask);
}
