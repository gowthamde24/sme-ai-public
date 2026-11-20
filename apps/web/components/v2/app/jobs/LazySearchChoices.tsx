"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Choices = lazy(() => import("./PlanSearch").then((m) => ({ default: m.SearchChoices })));

/** The three choices of a Lead Finder plan (area, how many, how close a match) as their own lazy chunk: only that plan has them, and /jobs/new must stay under its route-JS ceiling. A quiet block of about their height is drawn while it loads. Same props as `SearchChoices`. */
export function SearchChoices(props: ComponentProps<typeof Choices>) {
  return (
    <Suspense fallback={<span data-skeleton="" className="jb-skeleton block h-44 rounded-xl" />}>
      <Choices {...props} />
    </Suspense>
  );
}
