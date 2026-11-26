"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Row = lazy(() => import("./JobRow").then((m) => ({ default: m.JobRow })));

/** One job row as its own lazy chunk, for Today only (Today sits right at its route-JS ceiling). While it loads, a quiet block of the same height is drawn so the page does not move. Same props as `JobRow`. */
export function JobRow(props: ComponentProps<typeof Row>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-[68px] rounded-xl" />}>
      <Row {...props} />
    </Suspense>
  );
}
