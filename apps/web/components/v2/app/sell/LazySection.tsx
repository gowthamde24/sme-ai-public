"use client";

import { Suspense, lazy, type ComponentProps } from "react";

import { Skeleton } from "../ds/Skeleton";

const Inner = lazy(() => import("./SellSection").then((m) => ({ default: m.SellSection })));

/**
 * `SellSection` as its own lazy chunk (JOBS only): the page's route ships this wrapper and nothing else of What you sell, so the route-JS ceilings stay as they are (a saree shop's `/catalogue` is the tight one and does not load it at all). The server draws the
 * section; the browser loads the chunk to make it work. Same props.
 */
export function SellSection(props: ComponentProps<typeof Inner>) {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Inner {...props} />
    </Suspense>
  );
}
