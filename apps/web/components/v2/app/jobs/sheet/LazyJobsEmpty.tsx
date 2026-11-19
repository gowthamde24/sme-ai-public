"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Empty = lazy(() => import("./JobsEmpty").then((m) => ({ default: m.JobsEmpty })));

/** The empty Jobs page's three live cards as their own lazy chunk (the Jobs page stays under its route-JS ceiling; most workspaces never draw this). */
export function JobsEmpty(props: ComponentProps<typeof Empty>) {
  return (
    <Suspense fallback={null}>
      <Empty {...props} />
    </Suspense>
  );
}
