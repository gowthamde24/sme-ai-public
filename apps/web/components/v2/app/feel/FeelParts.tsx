"use client";

import { WaitingChip } from "../robust/WaitingChip";
import { FeelWatcher } from "./FeelWatcher";

/** The top bar's two small parts of app v4 part 9 (the "Waiting for network" chip and the watcher that buzzes when something needs the owner), as ONE chunk loaded after the page is up (the route-JS budget). */
export function FeelParts({ tenantId, labels }: { tenantId: string; labels?: Parameters<typeof WaitingChip>[0]["labels"] }) {
  return (
    <>
      <WaitingChip labels={labels} />
      <FeelWatcher tenantId={tenantId} />
    </>
  );
}
