"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Card = lazy(() => import("./ResearcherCard"));

/** The researcher card (JOBS) as its own lazy chunk: the Prospects page's first load must stay under its route-JS ceiling, and the card is only drawn with JOBS on. Same props as `ResearcherCard`. */
export function ResearcherCard(props: ComponentProps<typeof Card>) {
  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}
