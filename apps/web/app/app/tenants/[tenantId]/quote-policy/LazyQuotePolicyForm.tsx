"use client";

import dynamic from "next/dynamic";

/** The form that publishes a quote policy, as a chunk of its own: it is one tab of Settings (Quotes), so it is not in the first load of the Settings route (the route-JS budget counts that). */
export const QuotePolicyForm = dynamic(() => import("./quote-policy-form").then((m) => m.QuotePolicyForm));
