"use client";

import dynamic from "next/dynamic";

/**
 * "Live now" as a chunk of its own, loaded after the page (job demo-video, route-JS budget): it draws nothing until its first poll answers anyway, so Today's first load does not carry it.
 * Not drawn on the server (it reads the browser's frame store and polls).
 */
export const LiveNow = dynamic(() => import("./LiveNow").then((m) => m.LiveNow), { ssr: false });
