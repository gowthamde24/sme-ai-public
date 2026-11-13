"use client";

import dynamic from "next/dynamic";

/** "Your assistant is working on" (Pause, Undo) is a chunk of its own (design system v6): Today's first paint does not carry it. */
export const LazyWorkingOn = dynamic(() => import("./WorkingOn"), { loading: () => <div aria-hidden="true" className="min-h-40" /> });
