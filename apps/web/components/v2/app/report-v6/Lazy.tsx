"use client";

import dynamic from "next/dynamic";

/** The two glossy line charts and the "Download PDF" button as one chunk of their own (the route-JS budget counts the first load): the page draws everything else on the server, and the numbers are in a table for screen readers while the chart arrives. */
export const EnquiryChart = dynamic(() => import("./charts").then((m) => m.EnquiryChart));
export const SalesChart = dynamic(() => import("./charts").then((m) => m.SalesChart));
export const PrintButton = dynamic(() => import("./charts").then((m) => m.PrintButton));
