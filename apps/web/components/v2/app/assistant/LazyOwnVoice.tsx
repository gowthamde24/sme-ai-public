"use client";

import dynamic from "next/dynamic";

/**
 * The own-voice card (job DP) as a chunk of its own, like the assistant's form: it records sound and reads files, about 6 KB of script that only the Owner opens, on one part of one screen, so it is not in the route's first load
 * (the route-JS budget counts that). Drawn on the server like the rest and live when the chunk arrives.
 */
export const OwnVoice = dynamic(() => import("./OwnVoice").then((m) => m.OwnVoice));
