"use client";

import { Suspense, lazy } from "react";

const BrandLoading = lazy(() => import("./BrandLoading"));

/** The branded loading as its own lazy chunk (route-JS budget: it must not weigh on every route's first load; the orb breathes only after 300 ms anyway, and the first-open mark appears once the chunk is in). */
export function LazyBrandLoading() {
  return (
    <Suspense fallback={null}>
      <BrandLoading />
    </Suspense>
  );
}
