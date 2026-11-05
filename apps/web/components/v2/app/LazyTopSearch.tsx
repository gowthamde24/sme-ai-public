"use client";

import dynamic from "next/dynamic";

/** The top bar's search button and its glass on scroll, out of the first load of every route (like the menu's meters). */
export const TopSearch = dynamic(() => import("./TopSearch").then((m) => m.TopSearch));
