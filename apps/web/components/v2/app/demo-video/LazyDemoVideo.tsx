"use client";

import dynamic from "next/dynamic";

/** The demo video as a chunk of its own: only a demo workspace with DEMO_VIDEO on, asked with ?demo=video, loads it (the route-JS budget counts the first load of Today). */
export const DemoVideo = dynamic(() => import("./DemoVideo"));
