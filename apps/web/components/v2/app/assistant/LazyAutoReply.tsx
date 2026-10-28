"use client";

import dynamic from "next/dynamic";

/** The automatic-reply switch as a chunk of its own: one small part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const AutoReply = dynamic(() => import("./AutoReply").then((m) => m.AutoReply));
