"use client";

import dynamic from "next/dynamic";

// rendered on the server too (the words are in the page at once); the interactive code arrives as a chunk
export const VoicesClient = dynamic(() => import("./below").then((m) => m.VoicesClient));
export const JobsClient = dynamic(() => import("./below").then((m) => m.JobsClient));
export const FaqClient = dynamic(() => import("./below").then((m) => m.FaqClient));
export const HowDemoClient = dynamic(() => import("./below").then((m) => m.HowDemoClient));
export const TryItClient = dynamic(() => import("./below").then((m) => m.TryItClient));
export const Reveal = dynamic(() => import("./below").then((m) => m.Reveal));
// the product's own orb inside its orange tick ring (components/v2/app/today/v6/OrbRing), drawn on a canvas: a chunk of its own, on the client only (the box is reserved in CSS)
export const OrbRingLazy = dynamic(() => import("@/components/v2/app/today/v6/OrbRing").then((m) => m.OrbRing), { ssr: false });
