"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Faq = lazy(() => import("./JobLists").then((m) => ({ default: m.FaqCard })));
const Finds = lazy(() => import("./JobLists").then((m) => ({ default: m.FindsOutCard })));
const Who = lazy(() => import("./WhoTalks").then((m) => ({ default: m.WhoTalks })));

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

/** The Who talks card as its own lazy chunk (a quiet block of about its height is drawn while it loads, so the page does not jump). Same props as `WhoTalks`. */
export function WhoTalks(props: ComponentProps<typeof Who>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-72 rounded-2xl" />}>
      <Who {...props} />
    </Suspense>
  );
}
