"use client";

import dynamic from "next/dynamic";

/** The speed-to-lead rules as a chunk of their own: one card of one tab, so it is not in the first load of the route (the route-JS budget counts that). */
export const SpeedToLead = dynamic(() => import("./SpeedToLead").then((m) => m.SpeedToLead));
