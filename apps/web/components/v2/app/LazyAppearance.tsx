"use client";

import dynamic from "next/dynamic";

// its own chunk: the account menu is in every page's frame, so no page's first load carries the three buttons (the route-JS budget)
export const Appearance = dynamic(() => import("./Appearance").then((m) => m.Appearance), { ssr: false, loading: () => <div className="min-h-[72px]" aria-hidden="true" /> });
