"use client";

import dynamic from "next/dynamic";

/** Settings > Activity as a chunk of its own, like the assistant's parts: only an Owner or Admin opens it, on one tab, so it stays out of the route's first load (the route-JS budget counts that). */
export const AssistantActivity = dynamic(() => import("./AssistantActivity").then((m) => m.AssistantActivity));
