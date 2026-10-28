"use client";

import dynamic from "next/dynamic";

/** The voice chat as a chunk of its own: it is loaded only when the orb is pressed (the route-JS budget counts the first load of every route). */
export const VoiceChat = dynamic(() => import("./VoiceChat").then((m) => m.VoiceChat), { ssr: false });
