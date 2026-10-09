import type { ReactNode } from "react";

import { ScreenIsland } from "@/components/v2/app/island";

/** The agents screen is in the v2 look (workspace redesign, Batch 3). Its folder layout makes the v2 island for its content; the frame is drawn by app/app/layout.tsx. */
export default function AgentsLayout({ children }: { children: ReactNode }) {
  return <ScreenIsland>{children}</ScreenIsland>;
}
