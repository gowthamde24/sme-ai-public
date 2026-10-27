"use client";

import dynamic from "next/dynamic";

/** The orb's drawing code as a chunk of its own (about 2 KB): a page that shows the circle draws its dark placeholder at once and the ribbons start when the chunk arrives, so the route's first load does not carry it (the route-JS budget counts that). */
export const AssistantOrb = dynamic(() => import("./AssistantOrb").then((m) => m.AssistantOrb), { ssr: false });
