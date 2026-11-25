"use client";

import dynamic from "next/dynamic";

/**
 * The commerce, team-chat, calendar and lead-form cards load when the Connectors page opens, as their own chunk, so they are not in the route's first-load JS (route budget, release 2). Same props as CommerceConnectors.
 */
export const CommerceConnectors = dynamic(() => import("./CommerceConnectors").then((m) => m.CommerceConnectors), { ssr: true });
