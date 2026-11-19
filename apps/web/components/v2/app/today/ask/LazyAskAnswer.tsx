"use client";

import dynamic from "next/dynamic";

/** The answer under the composer (`AskAnswer`, the drawing of the thread's last exchange and the earlier ones) is a chunk of its own: Today's first load does not carry it, the first use of the composer or the orb starts it (perf fix b, ask-wake.ts). */
export const LazyAskAnswer = dynamic(() => import("./AskView").then((m) => m.AskAnswer), { ssr: false });
