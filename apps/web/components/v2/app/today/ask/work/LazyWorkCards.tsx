"use client";

import dynamic from "next/dynamic";

/** The work cards (plan, preview, secret, setup, can't-do) as a chunk of their own: drawn only under an answer that has one, so the chat in every page's first load does not carry them. */
export const WorkCards = dynamic(() => import("./WorkCards").then((m) => m.WorkCards));
