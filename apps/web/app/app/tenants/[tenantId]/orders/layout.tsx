import type { ReactNode } from "react";

import { ScreenIsland } from "@/components/v2/app/island";

/** The orders screens are in the v2 look (workspace redesign, Batch 1B). Their folder layout makes the v2 island for their content; the frame is drawn by app/app/layout.tsx. */
export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <ScreenIsland>{children}</ScreenIsland>;
}
