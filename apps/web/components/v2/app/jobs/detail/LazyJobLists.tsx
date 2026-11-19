"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Faq = lazy(() => import("./JobLists").then((m) => ({ default: m.FaqCard })));
const Finds = lazy(() => import("./JobLists").then((m) => ({ default: m.FindsOutCard })));

/** The two lists of the job page (what it finds out, the answers it gives) as their own lazy chunk: they sit below the first screen and the page must stay under its route-JS ceiling. Same props as in `JobLists`. */
export function FaqCard(props: ComponentProps<typeof Faq>) {
  return (
    <Suspense fallback={null}>
      <Faq {...props} />
    </Suspense>
  );
}

export function FindsOutCard(props: ComponentProps<typeof Finds>) {
  return (
    <Suspense fallback={null}>
      <Finds {...props} />
    </Suspense>
  );
}
