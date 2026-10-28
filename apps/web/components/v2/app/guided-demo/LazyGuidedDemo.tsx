"use client";

import dynamic from "next/dynamic";

/** The guided demo as a chunk of its own: only the DEMO workspaces, with the flag on, load it (the route-JS budget counts the first load of every route). */
export const GuidedDemo = dynamic(() => import("./GuidedDemo"));
