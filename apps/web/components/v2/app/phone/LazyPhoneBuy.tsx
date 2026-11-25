"use client";

import dynamic from "next/dynamic";

/** "Get a phone number" (four steps) as a chunk of its own (one part of one screen; the route-JS budget counts the first load). */
export const PhoneBuy = dynamic(() => import("./PhoneBuy").then((m) => m.PhoneBuy));
