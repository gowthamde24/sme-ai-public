"use client";

import dynamic from "next/dynamic";

/** "How I talk to customers" as a chunk of its own, like the opening-line editor: only the Owner and Admin open it, on one tab of one screen, so it stays out of the route's first load (the route-JS budget counts that). */
export const TalkTraining = dynamic(() => import("./TalkTraining").then((m) => m.TalkTraining));
