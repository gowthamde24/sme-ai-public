"use client";

import dynamic from "next/dynamic";

/**
 * The Ask box of Today's command bar when the assistant's chat is not live here (no browser voice, an older workspace): a chunk of its own. Where the chat is live (staging, the demo workspaces) the bar is the chat itself and this is never
 * loaded, so it stays out of every route's first load (the route-JS budget). The bar draws an empty box of its own height until the chunk arrives, so nothing jumps.
 */
export const AskCard = dynamic(() => import("./AskCard").then((m) => m.AskCard), { loading: () => <div aria-hidden="true" className="h-[10rem]" /> });
