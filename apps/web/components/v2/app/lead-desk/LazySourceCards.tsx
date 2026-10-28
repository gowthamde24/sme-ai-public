"use client";

import dynamic from "next/dynamic";

/** The source cards as a chunk of their own (one part of one screen; the route-JS budget counts the first load). */
export const SourceCards = dynamic(() => import("./SourceCards").then((m) => m.SourceCards));
