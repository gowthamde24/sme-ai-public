"use client";

import dynamic from "next/dynamic";

/** The owner's test-call form as a chunk of its own: one small part of one screen, so it is not in the first load of the Calls route (the route-JS budget counts that). */
export const TestCallForm = dynamic(() => import("./TestCallForm").then((m) => m.TestCallForm));
