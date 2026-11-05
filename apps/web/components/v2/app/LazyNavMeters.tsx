"use client";

import dynamic from "next/dynamic";

/**
 * The menu's foot (the two meters and "Top up · Plan & usage · Help") as a chunk of its own: its numbers come after the first paint anyway (C1's nav-counts), so no page's first load carries it (the route-JS budget). The phone's More
 * sheet, itself a lazy chunk, draws the real one. Tests mock this module to the real foot.
 */
export const NavMeters = dynamic(() => import("./NavMeters").then((m) => m.NavMeters), { ssr: false });
