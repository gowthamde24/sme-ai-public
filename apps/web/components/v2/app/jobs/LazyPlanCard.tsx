"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Card = lazy(() => import("./PlanCard"));

/** The plan card as its own lazy chunk (it is only drawn after a plan is asked for; /jobs/new must stay under its route-JS ceiling). Same props as `PlanCard`. */
export function PlanCard(props: ComponentProps<typeof Card>) {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
