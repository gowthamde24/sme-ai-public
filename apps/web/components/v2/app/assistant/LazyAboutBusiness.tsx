"use client";

import dynamic from "next/dynamic";

/** "About my business" as a chunk of its own, like the opening-line editor: one part of one screen, so it is not in the first load of the route (the route-JS budget counts that). */
export const AboutBusiness = dynamic(() => import("./AboutBusiness").then((m) => m.AboutBusiness));
