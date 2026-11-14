"use client";

import { useId, useState, useTransition } from "react";

import { assignAction, replyAction, statusAction } from "@/app/staff/actions";
import { dateTime, waiting } from "@/lib/staff/format";
import type { TicketStatus, TicketThread } from "@/lib/staff/types";
import { TICKET_STATUSES } from "@/lib/staff/types";
import type { Failure } from "@/lib/staff/source";
import { CHANNEL, PRIORITY, SUP, TICKET_STATUS } from "@/lib/staff/words";

import { leaveIfSignedOut } from "./outcome";

/**
 * One support ticket (owner and support): who and what it is about, the messages oldest first (a reply or an internal note, each marked "Saved on the ticket, not sent yet" because delivery to the shop is not built), a box to write a
 * reply or a note, the status and the assignee (to me / nobody: the contract has no list of staff to pick from). Every change is a server action; the answer is the whole thread, drawn as it comes. A closed ticket refuses a reply with
 * the plain sentence "reopen it first".
 */
export function TicketThreadView({ initial, myStaffId }: { initial: TicketThread; myStaffId: string }) {
  const id = useId();
  const [thread, setThread] = useState(initial);
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function say(failure: Failure, fallback: string): void {
    if (leaveIfSignedOut(failure)) return;
    setError(failure === "ticket_closed" ? SUP.replyClosed : failure === "not_found" ? SUP.notFound : fallback);
  }
  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text.length < 1 || text.length > 4000) return void setError(SUP.replyEmpty);
    setError(null);
    start(async () => {
      const out = await replyAction(thread.id, text, kind);
      if (out.ok) {
        setThread(out.data);
        setBody("");
      } else say(out.failure, SUP.replyFailed);
    });
  }
  function setStatus(status: TicketStatus) {
    setError(null);
    start(async () => {
      const out = await statusAction(thread.id, status);
      if (out.ok) setThread(out.data);
      else say(out.failure, SUP.changeFailed);
    });
  }
  function assign(who: "me" | "none") {
    setError(null);
    start(async () => {
      const out = await assignAction(thread.id, who);
      if (out.ok) setThread(out.data);
      else say(out.failure, SUP.changeFailed);
    });
  }
  const mine = myStaffId !== "" && thread.assigneeId === myStaffId;

  return (
    <>
      <section className="sc-card" data-part="thread-head" aria-labelledby={`${id}-h`}>
        <div className="sc-ch">
          <h3 id={`${id}-h`}>{thread.subject}</h3>
          <span className="sc-pr" data-p={thread.priority}>{PRIORITY[thread.priority]}</span>
        </div>
        <ul className="sc-list">
          <li className="sc-li"><span>{SUP.listBusiness}</span><b>{thread.businessName}</b></li>
          <li className="sc-li"><span>Channel</span><b>{CHANNEL[thread.channel] ?? thread.channel}</b></li>
          <li className="sc-li"><span>{SUP.listWaiting}</span><b>{thread.status === "closed" ? "—" : waiting(thread.waitingMinutes)}</b></li>
          <li className="sc-li">
            <span>{SUP.statusLabel}</span>
            <span className="sc-chips" role="group" aria-label={SUP.statusLabel}>
              {TICKET_STATUSES.map((s) => (
                <button key={s} type="button" className="sc-chip" aria-pressed={thread.status === s} data-status={s} disabled={pending || thread.status === s} onClick={() => setStatus(s)}>
                  {TICKET_STATUS[s]}
                </button>
              ))}
            </span>
          </li>
          <li className="sc-li">
            <span>{SUP.assignLabel}</span>
            <span className="sc-chips">
              <b data-part="assignee">{thread.assignee ?? SUP.unassigned}</b>
              {!mine ? <button type="button" className="sc-btn" disabled={pending} onClick={() => assign("me")}>{SUP.assignMe}</button> : null}
              {thread.assignee ? <button type="button" className="sc-btn" disabled={pending} onClick={() => assign("none")}>{SUP.unassign}</button> : null}
            </span>
          </li>
        </ul>
      </section>
      <section className="sc-card" data-part="messages" aria-label="Messages">
        {thread.messages.length === 0 ? (
          <p className="sc-empty">{SUP.threadNone}</p>
        ) : (
          <ol className="sc-list sc-msgs">
            {thread.messages.map((m) => (
              <li key={m.id} className="sc-msg" data-kind={m.kind}>
                <div className="sc-msgh">
                  <b>{m.staffName}</b>
                  <span className="sc-tag2">{m.kind === "note" ? SUP.noteTag : SUP.replyTag}</span>
                  <small>{m.at ? dateTime(m.at) : "—"}</small>
                </div>
                <p>{m.body}</p>
                {!m.delivered && m.kind === "reply" ? <small className="sc-undelivered">{SUP.savedNotSent}</small> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      <form className="sc-card sc-reply" onSubmit={send} noValidate data-part="reply-form">
        <fieldset className="sc-kinds">
          <legend>{SUP.replyLabel}</legend>
          <label className="sc-radio"><input type="radio" name={`${id}-kind`} checked={kind === "reply"} onChange={() => setKind("reply")} /><span>{SUP.kindReply}</span></label>
          <label className="sc-radio"><input type="radio" name={`${id}-kind`} checked={kind === "note"} onChange={() => setKind("note")} /><span>{SUP.kindNote}</span></label>
        </fieldset>
        <label className="sc-field">
          <span className="sc-sr">{SUP.replyLabel}</span>
          <textarea className="sc-textarea" value={body} maxLength={4000} onChange={(e) => { setBody(e.target.value); setError(null); }} />
        </label>
        <p className="sc-hint">{SUP.replyHelp}</p>
        {error ? <p role="alert" className="sc-err">{error}</p> : null}
        <div className="sc-actions">
          <button type="submit" className="sc-btn sc-primary" disabled={pending}>{kind === "note" ? SUP.sendNote : SUP.sendReply}</button>
        </div>
      </form>
    </>
  );
}
