"use client";

import * as React from "react";

import { useNavCounts } from "../use-nav-counts";
import { feel } from "./feel";

/** Something needs the owner (app v4 part 9): a short buzz and tone when the number of things waiting for the owner goes UP (never on the first reading, never when it goes down). Mounted once in the top bar. */
export function FeelWatcher({ tenantId }: { tenantId: string }) {
  const counts = useNavCounts(tenantId);
  const before = React.useRef<number | null>(null);
  const now = counts.needsYou;
  React.useEffect(() => {
    if (now === null) return;
    if (before.current !== null && now > before.current) feel("needs");
    before.current = now;
  }, [now]);
  return null;
}
