"use client";

import dynamic from "next/dynamic";

/** The phone's More sheet as a chunk of its own (drawn only after "More" is pressed): no page's first load carries it. Tests mock this module to the real sheet. */
export const MoreSheet = dynamic(() => import("./MoreSheet").then((m) => m.MoreSheet), { ssr: false });
