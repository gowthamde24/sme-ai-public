"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Line = lazy(() => import("./JobLine").then((m) => ({ default: m.JobLine })));

/** One open job line as its own lazy chunk, for Today only (Today sits right at its route-JS ceiling). A quiet block of the same height is drawn while it loads. Same props as `JobLine`. */
export function JobLine(props: ComponentProps<typeof Line>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-[76px] rounded-xl" />}>
      <Line {...props} />
    </Suspense>
  );
}
