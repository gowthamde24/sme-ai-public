"use client";

import dynamic from "next/dynamic";

/** Today's top band and its phone parts are chunks of their own (design system v6): Today is a heavy route, its first paint does not carry the command bar, the status card or the phone bar. */
export const LazyTodayBand = dynamic(() => import("./TodayBand").then((m) => m.TodayBand), { loading: () => <div aria-hidden="true" className="min-h-40" /> });
export const LazyTodayBandAfter = dynamic(() => import("./TodayBand").then((m) => m.TodayBandAfter), { ssr: false });
