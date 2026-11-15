"use client";

import dynamic from "next/dynamic";

/** The assistant name field as a chunk of its own (only an Owner or Admin sees it; the route-JS budget counts the first load of Settings). */
export const AssistantNameCard = dynamic(() => import("./AssistantNameCard").then((m) => m.AssistantNameCard));
