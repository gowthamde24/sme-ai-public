"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Mark = lazy(() => import("./MarkContacted"));

/** "Mark as contacted" as its own lazy chunk (the Prospects page's first load must stay under its route-JS ceiling). Same props as `MarkContacted`. */
export function MarkContacted(props: ComponentProps<typeof Mark>) {
  return (
    <Suspense fallback={null}>
      <Mark {...props} />
    </Suspense>
  );
}
