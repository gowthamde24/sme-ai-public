import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { jobsScreens } from "@/lib/screens/flag";

/**
 * A second guard behind proxy.ts (lib/jobs/closed.ts): with JOBS off these pages answer "not found" at the proxy with a true 404 status, before anything renders. Here it only makes sure the page is never drawn if a request ever got past the proxy
 * (a layout cannot give the status itself: the pages have a loading screen, so the reply has already started with 200 by then).
 */
export default function JobsLayout({ children }: { children: ReactNode }) {
  if (jobsScreens() === "off") notFound();
  return children;
}
