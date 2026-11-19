import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { jobsScreens } from "@/lib/screens/flag";

/**
 * The Jobs pages are not there while JOBS is off. The answer is given HERE, in the layout, and not in the page: the page has a loading screen (loading.tsx), so by the time it decides, the reply has already started with status 200;
 * a layout runs before that, so a missing page is a true 404 (planner's decision, 19 Nov).
 */
export default function JobsLayout({ children }: { children: ReactNode }) {
  if (jobsScreens() === "off") notFound();
  return children;
}
