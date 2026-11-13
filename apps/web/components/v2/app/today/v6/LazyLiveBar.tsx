"use client";

import dynamic from "next/dynamic";

/** The live conversation is a chunk of its own: Today's route-JS budget (a heavy route) does not carry it; it loads when the orb is tapped (design system v6). */
export const LazyLiveBar = dynamic(() => import("./LiveBar"), {
  ssr: false,
  loading: () => <div role="status" aria-live="polite" data-part="talk-loading" className="min-h-24" />,
});
