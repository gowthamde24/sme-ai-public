"use client";

import { useCallback, useState } from "react";

import { unmaskAction } from "@/app/staff/actions";
import { dateTime, mmss } from "@/lib/staff/format";
import type { SupportView, Unmasked } from "@/lib/staff/types";
import { SUP } from "@/lib/staff/words";

import { ActionDialog } from "./ActionDialog";
import { StaffIcon } from "./StaffIcon";
import { leaveIfSignedOut } from "./outcome";

/**
 * The ten latest calls and chats of the support view. Names and numbers come masked. With `canUnmask` (owner and support) "Show real names and numbers" asks a SECOND reason (words always) and fills in the real ones from ONE look
 * (C1 slice 4): they live only in this component's memory, are never stored or put in the address, and "Hide again", a reload or going back masks them again; every look asks again. While unmasked a clear banner says so.
 */
export function PeopleLists({ calls, chats, tenantId, accessId, canUnmask }: { calls: SupportView["recentCalls"]; chats: SupportView["recentChats"]; tenantId: string; accessId: string; canUnmask: boolean }) {
  const [real, setReal] = useState<Unmasked | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const callBy = new Map((real?.calls ?? []).map((c) => [c.id, c]));
  const chatBy = new Map((real?.chats ?? []).map((c) => [c.leadId, c]));

  async function onSubmit(code: string, note: string): Promise<string | null> {
    const out = await unmaskAction(tenantId, accessId, code, note);
    if (out.ok) {
      setReal(out.data);
      setOpen(false);
      return null;
    }
    if (leaveIfSignedOut(out.failure)) return null;
    if (out.failure === "access_required") return SUP.accessExpired;
    if (out.failure === "reason_required") return SUP.unmaskNote;
    return SUP.unmaskFailed;
  }

  return (
    <>
      {real ? (
        <div className="sc-banner sc-unmasked" role="status" data-part="unmasked-banner">
          <StaffIcon name="eye" size={18} />
          <div>
            <b>{SUP.unmaskBannerTitle}</b>
            <span>{SUP.unmaskBannerBody}</span>
          </div>
          <button type="button" className="sc-btn" onClick={() => setReal(null)}>{SUP.unmaskHide}</button>
        </div>
      ) : canUnmask ? (
        <div className="sc-toolrow">
          <button type="button" className="sc-btn" aria-haspopup="dialog" data-part="unmask" onClick={() => setOpen(true)}>
            <StaffIcon name="eye" size={14} />
            {SUP.unmask}
          </button>
        </div>
      ) : null}
      <div className="sc-g2">
        <section className="sc-card" aria-labelledby="sc-calls-h">
          <div className="sc-ch"><h3 id="sc-calls-h">Recent calls</h3></div>
          {calls.length === 0 ? <p className="sc-empty">No calls yet.</p> : (
            <ul className="sc-list">
              {calls.map((c) => {
                const r = callBy.get(c.id);
                return (
                  <li className="sc-li" key={c.id} data-unmasked={r ? "true" : undefined}>
                    <span>{r ? r.customer : c.customer}<small>{r ? r.customerPhone : c.customerPhone} · {c.at ? dateTime(c.at) : "—"}</small></span>
                    <span>{c.outcome || c.state}<small>{c.direction} · {mmss(c.durationS)}</small></span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="sc-card" aria-labelledby="sc-chats-h">
          <div className="sc-ch"><h3 id="sc-chats-h">Recent chats</h3></div>
          {chats.length === 0 ? <p className="sc-empty">No chats yet.</p> : (
            <ul className="sc-list">
              {chats.map((c) => {
                const r = chatBy.get(c.leadId);
                return (
                  <li className="sc-li" key={c.leadId} data-unmasked={r ? "true" : undefined}>
                    <span>{r ? r.customer : c.customer}<small>{r ? r.customerPhone : c.customerPhone}</small></span>
                    <span>{c.lastAt ? dateTime(c.lastAt) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {open ? <ActionDialog title={SUP.unmaskTitle} intro={SUP.unmaskIntro} noteLabel={SUP.unmaskNote} submitLabel={SUP.unmaskGo} onSubmit={onSubmit} onClose={close} /> : null}
    </>
  );
}
