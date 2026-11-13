"use client";

import dynamic from "next/dynamic";

/** "Your day" is a chunk of its own (design system v6): Today is a heavy route, its first paint does not carry the timeline. The space is kept so nothing jumps. */
export const LazyYourDay = dynamic(() => import("./YourDay"), { loading: () => <div aria-hidden="true" className="min-h-[168px] rounded-[20px] border border-line bg-surface" /> });
