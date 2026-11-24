"use client";

import dynamic from "next/dynamic";

/** The number picker as a chunk of its own (one part of one screen; the route-JS budget counts the first load). */
export const PhonePicker = dynamic(() => import("./PhonePicker").then((m) => m.PhonePicker));
