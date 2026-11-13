"use client";

import dynamic from "next/dynamic";

/** The Developer API keys card as a chunk of its own: only an Owner or Admin sees it, and the route-JS budget counts the first load of Settings. */
export const DeveloperKeysCard = dynamic(() => import("./DeveloperKeysCard").then((m) => m.DeveloperKeysCard));
