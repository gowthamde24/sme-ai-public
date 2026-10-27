"use client";

import dynamic from "next/dynamic";

/** The opening-line editor as a chunk of its own, like the assistant's form and the own-voice card: only the Owner and Admin open it, on one part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const OpeningLine = dynamic(() => import("./OpeningLine").then((m) => m.OpeningLine));
