"use client";

import dynamic from "next/dynamic";

/** Today's dark band and its phone parts are chunks of their own (design system v6): Today is a heavy route, its first paint does not carry the composer. The dark box is kept while it loads so nothing jumps. */
export const LazyTodayBand = dynamic(() => import("./TodayBand").then((m) => m.TodayBand), { loading: () => <div aria-hidden="true" className="ds-hero min-h-[300px]" /> });
export const LazyTodayBandAfter = dynamic(() => import("./TodayBand").then((m) => m.TodayBandAfter), { ssr: false });
