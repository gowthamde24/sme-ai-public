"use client";

import dynamic from "next/dynamic";

/** Today's stand-up card, out of Today's first load (the route-JS budget): only an Owner or Admin with My AI team v2 on ever loads it. */
export const StandupCard = dynamic(() => import("./StandupCard").then((m) => m.StandupCard));
