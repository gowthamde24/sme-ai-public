"use client";

import dynamic from "next/dynamic";

/**
 * Settings > AI assistant as a chunk of its own (job DM): the form is about 10 KB of script that only the Owner opens, on one part of one screen, while Settings is opened by everyone, so it is not in the route's first load (the route-JS
 * budget counts that). It is drawn on the server like the rest (the markup is in the page) and becomes live when the chunk arrives.
 */
export const AssistantSettings = dynamic(() => import("./AssistantSettings").then((m) => m.AssistantSettings));
