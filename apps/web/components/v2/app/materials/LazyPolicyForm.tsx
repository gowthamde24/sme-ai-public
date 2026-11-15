"use client";

import dynamic from "next/dynamic";

/** The quote rules form of a materials business, as a chunk of its own: one tab of Settings (Quotes), so it is not in the first load of the Settings route (the route-JS budget counts that). */
export const PolicyForm = dynamic(() => import("./PolicyForm").then((m) => m.PolicyForm));
