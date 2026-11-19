"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Inner = lazy(() => import("./ItemFieldsSimple").then((m) => ({ default: m.ItemFieldsSimple })));

/** `ItemFieldsSimple` as its own lazy chunk (JOBS only; a saree route's first-visit JavaScript has a budget). Same props. */
export function ItemFieldsSimple(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}
