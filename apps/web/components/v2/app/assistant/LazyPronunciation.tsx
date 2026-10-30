"use client";

import dynamic from "next/dynamic";

/** The pronunciation list as a chunk of its own: one part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const Pronunciation = dynamic(() => import("./Pronunciation").then((m) => m.Pronunciation));
