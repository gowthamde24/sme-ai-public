"use client";

import dynamic from "next/dynamic";

/** The grouped Settings list as a chunk of its own (the Settings route sits at its route-JS ceiling); a quiet block of the same height while it loads. */
export const SettingsSections = dynamic(() => import("./SettingsSections").then((m) => m.SettingsSections), { loading: () => <div aria-hidden="true" className="min-h-24" /> });
