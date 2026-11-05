"use client";

import dynamic from "next/dynamic";

/** The preview page's cards (all their made-up data) as a chunk of their own, so the page's first load stays inside the route-JS budget. Flag-only page (ASSISTANT_WORK_SCREENS). */
export const WorkPreview = dynamic(() => import("./WorkPreview").then((m) => m.WorkPreview));
