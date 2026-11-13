"use client";

import dynamic from "next/dynamic";

/** The day-one checklist is a chunk of its own (design system v6): a business sees it for a few days, Today is opened every day, so the route's first paint does not carry it. */
export const LazyDayOne = dynamic(() => import("./DayOne"), { loading: () => <div aria-hidden="true" className="min-h-64" /> });
