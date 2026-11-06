"use client";

import dynamic from "next/dynamic";

/** Settings > Lead Finder's form as a chunk of its own: one tab, for an Owner or Admin where the Lead Finder is available, so it stays out of the Settings route's first load. */
export const FinderSettingsForm = dynamic(() => import("./FinderSettingsForm").then((m) => m.FinderSettingsForm));
