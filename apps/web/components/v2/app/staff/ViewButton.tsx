"use client";

import { useCallback, useState } from "react";

import { TEXT } from "@/lib/staff/words";

import { ReasonDialog } from "./ReasonDialog";
import { StaffIcon } from "./StaffIcon";

/** "View": a read-only look at one business. It never opens anything itself: it asks for a reason first (ReasonDialog). */
export function ViewButton({ tenantId, name }: { tenantId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className="sc-btn" aria-haspopup="dialog" aria-label={`${TEXT.view} ${name}`} onClick={() => setOpen(true)}>
        <StaffIcon name="eye" size={14} />
        {TEXT.view}
      </button>
      {open ? <ReasonDialog tenantId={tenantId} name={name} onClose={close} /> : null}
    </>
  );
}
