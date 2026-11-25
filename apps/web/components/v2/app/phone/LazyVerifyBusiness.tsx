"use client";

import dynamic from "next/dynamic";

/** "Verify your business" as a chunk of its own (one part of one screen; the route-JS budget counts the first load). */
export const VerifyBusiness = dynamic(() => import("./VerifyBusiness").then((m) => m.VerifyBusiness));
