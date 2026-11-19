import { redirect } from "next/navigation";
import { Suspense, use, type ReactNode } from "react";

import { ApiAuthError } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";

/**
 * The pieces a page uses to draw itself in parts as its reads finish (Today and Leads: the heading and the first screen go out without waiting for the slowest data). Server side.
 *
 *  - `early(promise)` starts a read now: a rejection that arrives while the page waits for something else is not lost (the same promise is used where it is drawn, and raises there).
 *  - `settle(promise)` never rejects: it hands on the value or the error, so a part can decide what a failure looks like.
 *  - `<Part of={...} fallback={...} quiet={...}>` draws the part under its own Suspense: `fallback` holds its room until it is read; if its reads failed, a rejected session goes to the sign-in page as it always did and anything
 *    else is `quiet` (the one quiet sentence of that part, or nothing where the page leaves a part out when it cannot be read), never an unhandled error.
 */
export type Settled<V> = { ok: true; value: V } | { ok: false; error: unknown };

export const settle = <V,>(promise: Promise<V>): Promise<Settled<V>> => promise.then((value): Settled<V> => ({ ok: true, value }), (error: unknown): Settled<V> => ({ ok: false, error }));

export const early = <V,>(promise: Promise<V>): Promise<V> => {
  promise.catch(() => undefined);
  return promise;
};

function Show({ of, quiet }: { of: Promise<Settled<ReactNode>>; quiet: ReactNode }) {
  const r = use(of);
  if (r.ok) return <>{r.value}</>;
  if (r.error instanceof ApiAuthError) redirect("/login");
  escalate(r.error);
  return <>{quiet}</>;
}

export function Part({ of, fallback, quiet = null }: { of: Promise<Settled<ReactNode>>; fallback: ReactNode; quiet?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Show of={of} quiet={quiet} />
    </Suspense>
  );
}
