"use client";

import dynamic from "next/dynamic";

/** The voice picker as a chunk of its own: only the Owner opens it, on one part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const VoicePicker = dynamic(() => import("./VoicePicker").then((m) => m.VoicePicker));
