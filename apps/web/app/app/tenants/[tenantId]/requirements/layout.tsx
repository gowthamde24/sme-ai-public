import type { ReactNode } from "react";

import { ScreenIsland } from "@/components/v2/app/island";

/** The questions screen is is in the v2 look (workspace redesign, Batch 4). Its folder layout makes the v2 island for its content; the frame is drawn by app/app/layout.tsx. */
export default function RequirementsLayout({ children }: { children: ReactNode }) {
  return <ScreenIsland>{children}</ScreenIsland>;
}
