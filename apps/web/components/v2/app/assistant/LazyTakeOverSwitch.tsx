"use client";

import dynamic from "next/dynamic";

/** The take-over switch as a chunk of its own: one small part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const TakeOverSwitch = dynamic(() => import("./TakeOverSwitch").then((m) => m.TakeOverSwitch));
