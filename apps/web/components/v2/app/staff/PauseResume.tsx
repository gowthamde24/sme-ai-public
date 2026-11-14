"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { pauseAction, resumeAction } from "@/app/staff/actions";
import { SUP, TEXT } from "@/lib/staff/words";

import { ActionDialog } from "./ActionDialog";
import { leaveIfSignedOut } from "./outcome";

/**
 * Pause or resume ONE business's assistant (owner and support; C1 slice 2). A paused assistant stops answering inbound calls and the shop owner cannot go live until support resumes. Both ask for a reason first (words always, 3 to 300
 * characters). Resume is only offered when it is paused; if the pause was the shop owner's own, the API says there is nothing of support's to lift and the dialog says so. After it worked the page is read again.
 */
export function PauseResume({ tenantId, name, paused }: { tenantId: string; name: string; paused: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const run = paused ? resumeAction : pauseAction;
  async function onSubmit(code: string, note: string): Promise<string | null> {
    const out = await run(tenantId, code, note);
    if (out.ok) {
      setOpen(false);
      router.refresh();
      return null;
    }
    if (leaveIfSignedOut(out.failure)) return null;
    if (out.failure === "invalid") return paused ? SUP.resumeNothing : SUP.pauseFailed;
    if (out.failure === "reason_required") return TEXT.reasonSayWhat;
    if (out.failure === "no_access") return TEXT.reasonNoAccess;
    return SUP.pauseFailed;
  }
  return (
    <>
      <button type="button" className="sc-btn" aria-haspopup="dialog" data-part={paused ? "resume" : "pause"} onClick={() => setOpen(true)}>
        {paused ? SUP.resume : SUP.pause}
      </button>
      {open ? (
        <ActionDialog
          title={paused ? SUP.resumeTitle(name) : SUP.pauseTitle(name)}
          intro={paused ? SUP.resumeIntro : SUP.pauseIntro}
          noteLabel={TEXT.reasonNote}
          submitLabel={paused ? SUP.resumeGo : SUP.pauseGo}
          onSubmit={onSubmit}
          onClose={close}
        />
      ) : null}
    </>
  );
}
