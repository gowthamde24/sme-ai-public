"use client";

import Link from "next/link";
import { useActionState } from "react";

import { EVENT_LABELS, LOST_REASONS, LOST_REASON_LABELS, MONEY_EVENTS, type EventType } from "@/lib/api/orders";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, formCard, formTitle, link, noteBox } from "@/components/v2/app/ui";
import type { OrderActionState } from "./order-actions";

type Action = (prev: OrderActionState, formData: FormData) => Promise<OrderActionState>;

export interface EventFormIds {
  /** A retry of the same form sends the same event id and ledger id: the database then replays instead of recording twice. */
  eventId: string;
  ledgerId: string;
  /** The page's own render time and today's date in India (the default day of a money event). */
  renderedAt: string;
  today: string;
}

const BUTTON: Record<EventType, string> = {
  send_quote: "Record: quote sent",
  customer_accept: "Record: customer accepted",
  customer_decline: "Record: customer declined",
  expire: "Record: quote expired",
  request_advance: "Record: advance asked for",
  record_payment: "Record this payment",
  start_preparation: "Record: preparation started",
  dispatch: "Record: dispatched",
  deliver: "Record: delivered",
  cancel: "Cancel this order",
  record_refund: "Record this refund",
};

/**
 * One form for one event type the rules offer for this order. Every form records something that ALREADY HAPPENED outside this system: it sends nothing to anyone.
 * The second-factor notice replaces the form for the events that need it when the session has not used its authenticator app (the database checks again).
 */
export function EventForm({ type, action, ids, secondFactorMissing }: { type: EventType; action: Action; ids: EventFormIds; secondFactorMissing: boolean }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const money = (MONEY_EVENTS as readonly string[]).includes(type);
  const id = `event-${type}`;
  return (
    <form action={formAction} className={formCard} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className={formTitle}>
        {EVENT_LABELS[type]}
      </h4>
      {secondFactorMissing ? (
        <p role="note" className={noteBox}>
          This needs your authenticator app. <Link href="/app/security" className={link}>Set it up on the Security page</Link>, then sign in again with its code.
        </p>
      ) : (
        <>
          <input type="hidden" name="event_id" value={ids.eventId} />
          <input type="hidden" name="rendered_at" value={ids.renderedAt} />
          <input type="hidden" name="today" value={ids.today} />
          {money ? (
            <>
              <input type="hidden" name="ledger_id" value={ids.ledgerId} />
              <label htmlFor={`${id}-amount`} className={fieldLabel}>Amount in rupees</label>
              <input id={`${id}-amount`} className={fieldInput} name="amount" inputMode="decimal" autoComplete="off" required disabled={pending} placeholder="25,000" />
              <label htmlFor={`${id}-day`} className={fieldLabel}>The day it happened</label>
              <input id={`${id}-day`} className={fieldInput} name="happened_on" type="date" defaultValue={ids.today} max={ids.today} required disabled={pending} />
              <p className={fieldHelp}>The amount is your record of what arrived or went out. Nothing is collected or paid from here.</p>
            </>
          ) : null}
          {type === "customer_decline" ? (
            <>
              <label htmlFor={`${id}-reason`} className={fieldLabel}>Why</label>
              <select id={`${id}-reason`} className={fieldInput} name="reason" defaultValue="" required disabled={pending}>
                <option value="" disabled>
                  Choose a reason
                </option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {LOST_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {type === "dispatch" ? <p className={fieldHelp}>If the advance has not been paid, only the owner can dispatch (with their authenticator app).</p> : null}
          <button type="submit" className={type === "cancel" || type === "record_refund" ? btnQuiet : btnMain} disabled={pending}>
            {pending ? "Saving..." : BUTTON[type]}
          </button>
        </>
      )}
      <ActionResultV2 state={state} />
    </form>
  );
}
