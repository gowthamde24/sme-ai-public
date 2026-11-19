"use client";

import dynamic from "next/dynamic";

/** The upload field as a chunk of its own: only a screen that asks for a file needs it, so it stays out of that route's first load (the route-JS budget counts that). The placeholder has the area's height, so nothing jumps when it arrives. */
export const LazyFileField = dynamic(() => import("./FileField").then((m) => m.FileField), {
  loading: () => <div aria-hidden="true" className="min-h-14 w-full rounded-lg border-2 border-dashed border-edge bg-surface md:min-h-28" />,
});
