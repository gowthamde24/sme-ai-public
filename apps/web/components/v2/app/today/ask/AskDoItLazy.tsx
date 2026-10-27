"use client";

import dynamic from "next/dynamic";

/** The "Do it" parts are a chunk of their own (night 4, tasks): Today's route-JS budget does not carry the plan card, the live progress or the switch. They load after the conversation has arrived, and only when "Do it" is on for the person. */
export const DoItBar = dynamic(() => import("./AskDoIt").then((m) => m.DoItBar), { ssr: false });
export const DoItEntry = dynamic(() => import("./AskDoIt").then((m) => m.DoItEntry), { ssr: false });
