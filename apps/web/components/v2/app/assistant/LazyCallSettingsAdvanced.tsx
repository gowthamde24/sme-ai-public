"use client";

import dynamic from "next/dynamic";

/** "Advanced: how calls behave" (job DP) as a chunk of its own: a long form that only the Owner opens, on one part of one screen, so it is not in the route's first load (the route-JS budget counts that). */
export const CallSettingsAdvanced = dynamic(() => import("./CallSettingsAdvanced").then((m) => m.CallSettingsAdvanced));
