"use client";

import dynamic from "next/dynamic";

/** The weekly search's two interactive parts as chunks of their own: only the Owner and Admin ever draw them, so they stay out of the Prospects route's first load. */
export const SweepAdd = dynamic(() => import("./SweepControls").then((m) => m.SweepAdd));
export const SweepControls = dynamic(() => import("./SweepControls").then((m) => m.SweepControls));
