"use client";

import dynamic from "next/dynamic";

/** The interactive parts of the Calls page as chunks of their own (the route-JS budget counts the first load): the live strip, and the panel's transcript with "Teach this", outcome actions, recording player and live controls. They are drawn on the server as before; the chunk only wakes them. */
export const LiveStrip = dynamic(() => import("./LiveStrip").then((m) => m.LiveStrip));
export const PanelIslands = dynamic(() => import("./PanelIslands").then((m) => m.PanelIslands));
/** The page reads itself again while a call is live (the existing Repoll of the call pages, as a chunk of its own: it sits beside the take-over code). */
export const Repoll = dynamic(() => import("../CallClient").then((m) => m.Repoll));
