"use client";

import dynamic from "next/dynamic";

/** "Tell your assistant what to do" as a chunk of its own (one screen reached from the Jobs page; the route-JS budget counts what a page loads first). */
export const TellAssistant = dynamic(() => import("./TellAssistant").then((m) => m.TellAssistant));
