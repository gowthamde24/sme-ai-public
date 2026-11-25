"use client";

import dynamic from "next/dynamic";

/** "Hear it yourself" as a chunk of its own (it carries the talk body and the microphone code): one small card of one screen, so it is not in the first load of the Calls route (the route-JS budget counts that). */
export const HearItYourself = dynamic(() => import("./HearItYourself").then((m) => m.HearItYourself));
