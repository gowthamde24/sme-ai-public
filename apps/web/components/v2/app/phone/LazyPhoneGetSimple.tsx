"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Inner = lazy(() => import("./PhoneGetSimple").then((m) => ({ default: m.PhoneGetSimple })));

/** `PhoneGetSimple` as its own lazy chunk (JOBS only). Same props. */
export function PhoneGetSimple(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}
