"use client";

import dynamic from "next/dynamic";

/** The live panel's controls (Listen, Whisper, Take over, End) as a chunk of their own: they pull in the take-over code, which only a live call needs. */
export const LiveControls = dynamic(() => import("./LiveControls").then((m) => m.LiveControls));
