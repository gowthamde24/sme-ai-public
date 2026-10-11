"use client";

import Link from "next/link";
import { useActionState } from "react";

import { LOST_REASONS, MONEY_EVENTS, type EventType } from "@/lib/api/orders";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { makeT, type Words } from "@/components/v2/app/words";
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

/**
 * One form for one event type the rules offer for this order. Every form records something that ALREADY HAPPENED outside this system: it sends nothing to anyone.
 * The second-factor notice replaces the form for the events that need it when the session has not used its authenticator app (the database checks again).
 */
export function EventForm({ type, action, ids, secondFactorMissing, words }: { type: EventType; action: Action; ids: EventFormIds; secondFactorMissing: boolean; words?: Words }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(action, undefined);
  const money = (MONEY_EVENTS as readonly string[]).includes(type);
  const id = `event-${type}`;
  return (
    <form action={formAction} className={formCard} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className={formTitle}>
        {t(`orders.event.${type}`)}
      </h4>
      {secondFactorMissing ? (
        <p role="note" className={noteBox}>
          {t("orders.mfa_a")} <Link href="/app/security" className={link}>{t("orders.set_it_up_on_the_security")}</Link>{t("orders.mfa_b")}
        </p>
      ) : (
        <>
          <input type="hidden" name="event_id" value={ids.eventId} />
          <input type="hidden" name="rendered_at" value={ids.renderedAt} />
          <input type="hidden" name="today" value={ids.today} />
          {money ? (
            <>
              <input type="hidden" name="ledger_id" value={ids.ledgerId} />
              <label htmlFor={`${id}-amount`} className={fieldLabel}>{t("orders.amount_in_rupees")}</label>
              <input id={`${id}-amount`} className={fieldInput} name="amount" inputMode="decimal" autoComplete="off" required disabled={pending} placeholder="25,000" />
              <label htmlFor={`${id}-day`} className={fieldLabel}>{t("orders.the_day_it_happened")}</label>
              <input id={`${id}-day`} className={fieldInput} name="happened_on" type="date" defaultValue={ids.today} max={ids.today} required disabled={pending} />
              <p className={fieldHelp}>{t("orders.the_amount_is_your_record_of")}</p>
            </>
          ) : null}
          {type === "customer_decline" ? (
            <>
              <label htmlFor={`${id}-reason`} className={fieldLabel}>{t("orders.why")}</label>
              <select id={`${id}-reason`} className={fieldInput} name="reason" defaultValue="" required disabled={pending}>
                <option value="" disabled>
                  {t("orders.choose_a_reason")}
                </option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`orders.lost.${r}`)}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {type === "dispatch" ? <p className={fieldHelp}>{t("orders.if_the_advance_has_not_been")}</p> : null}
          <button type="submit" className={type === "cancel" || type === "record_refund" ? btnQuiet : btnMain} disabled={pending}>
            {pending ? t("orders.saving") : t(`orders.btn.${type}`)}
          </button>
        </>
      )}
      <ActionResultV2 state={state} />
    </form>
  );
}
