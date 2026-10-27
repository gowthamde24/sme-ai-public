"use client";

import dynamic from "next/dynamic";

/**
 * The buttons and forms of Usage and top-ups, as a chunk of their own (night 4, part F2): Settings is near its route-JS budget, so the script comes only when the Plan part is open, never with the page's first load. The page is
 * drawn on the server like the rest and the controls come alive when the chunk arrives.
 */
export const TopupControls = dynamic(() => import("./TopupControls").then((m) => m.TopupControls));
