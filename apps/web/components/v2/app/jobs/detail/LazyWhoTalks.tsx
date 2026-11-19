"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Card = lazy(() => import("./WhoTalks").then((m) => ({ default: m.WhoTalks })));

/** The Who talks card as its own lazy chunk (the job page is tight on its route-JS ceiling). While it loads a quiet block of about its height is drawn so the page does not jump. Same props as `WhoTalks`. */
export function WhoTalks(props: ComponentProps<typeof Card>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-72 rounded-2xl" />}>
      <Card {...props} />
    </Suspense>
  );
}
