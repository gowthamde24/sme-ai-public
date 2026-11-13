"use client";

import dynamic from "next/dynamic";

/** The conversation (bubbles, the reply card, the composer with its microphone, "Teach this") and the customer card's Approve as chunks of their own: the route-JS budget counts the first load, and the list on the left needs none of it. */
export const Conversation = dynamic(() => import("./Conversation").then((m) => m.Conversation));
export const QuoteOutcome = dynamic(() => import("@/components/v2/app/ds/QuoteOutcome").then((m) => m.QuoteOutcome));
