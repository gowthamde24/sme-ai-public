"use client";

import dynamic from "next/dynamic";

/** The saved "Introduce as" of the test calls, as a chunk of its own (like the test-call form: not in the first load of the Calls route). */
export const TestCallIntroduce = dynamic(() => import("./TestCallIntroduce").then((m) => m.TestCallIntroduce));
