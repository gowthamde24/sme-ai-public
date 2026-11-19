"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Festival = lazy(() => import("./FestivalSuggestion").then((m) => ({ default: m.FestivalSuggestion })));

/** Today's festival suggestion as its own lazy chunk (Today is tight on route JS; most days there is no festival to suggest). Same props as `FestivalSuggestion`. */
export function FestivalSuggestion(props: ComponentProps<typeof Festival>) {
  return (
    <Suspense fallback={null}>
      <Festival {...props} />
    </Suspense>
  );
}
