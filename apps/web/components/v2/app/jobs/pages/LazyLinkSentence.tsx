"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Inner = lazy(() => import("./LinkSentence").then((m) => ({ default: m.LinkSentence })));

/** `LinkSentence` as its own lazy chunk (JOBS only; the Calls, Leads and Reports routes stay under their route-JS ceilings). Same props. */
export function LinkSentence(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}
