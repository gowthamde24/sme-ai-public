"use client";

import dynamic from "next/dynamic";

/** The lead sources board as a chunk of its own (night 4): the cards, the forms and the copy boxes are only needed on this one page, so they are not in the route's first load (the route-JS budget counts that). */
export const LazyLeadSources = dynamic(() => import("./LeadSources").then((m) => m.LeadSources));
