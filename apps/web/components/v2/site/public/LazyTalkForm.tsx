"use client";

import dynamic from "next/dynamic";

/** The Talk to us form as a chunk of its own: only /talk draws it, and the route-JS budget counts the first load of every public route (the catch-all shares one set of files). Still rendered on the server; only its script loads later. */
export const TalkForm = dynamic(() => import("./TalkForm").then((m) => m.TalkForm));
