"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Plan = lazy(() => import("./SearchPlan").then((m) => ({ default: m.SearchPlan })));

/** The research-plan part of the plan card as its own lazy chunk (a quiet block of about its height while it loads). Same props as `SearchPlan`. */
export function SearchPlan(props: ComponentProps<typeof Plan>) {
  return (
    <Suspense fallback={<span data-skeleton="" className="jb-skeleton block h-72 rounded-xl" />}>
      <Plan {...props} />
    </Suspense>
  );
}
