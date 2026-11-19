"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Inner = lazy(() => import("./PolicySentences").then((m) => ({ default: m.PolicySentences })));

/** `PolicySentences` as its own lazy chunk (JOBS only; the Rules page must stay under its route-JS ceiling). Same props. */
export function PolicySentences(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}
