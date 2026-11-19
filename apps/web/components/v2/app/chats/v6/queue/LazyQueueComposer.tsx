"use client";

import dynamic from "next/dynamic";

/** The composer of a closed 24 hour window (the box, the queue's status area, its poll) as a chunk of its own: an open window and the old behaviour never load it, and the Chats route does not carry it. */
export const QueueComposer = dynamic(() => import("./QueueComposer").then((m) => m.QueueComposer));
