"use client";

import dynamic from "next/dynamic";

/** The import screen as a chunk of its own (night 4): file reading, the column table, the consent form and the preview are only needed on this one page, so they are not in the route's first load (the route-JS budget counts that). */
export const LazyImportScreen = dynamic(() => import("./ImportScreen").then((m) => m.ImportScreen));
