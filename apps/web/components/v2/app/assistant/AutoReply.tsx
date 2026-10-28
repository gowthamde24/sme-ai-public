"use client";

import * as React from "react";

import type { AutoReply as State, AutoReplyError } from "@/lib/auto-reply/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

type Out = { ok: true; data: State } | { ok: false; error: AutoReplyError };

/**
 * Settings > AI assistant > "Automatic replies" (job DY, C1's `GET/PUT /ai-assistant/auto-reply`): ONE switch that lets the assistant answer customers' WhatsApp messages on its own. In plain words: what it does, the three rules it always follows (answers within 24 hours; asks the owner
 * before any price, discount or promise; hands over when unsure or when the customer asks for a person), and what it did today. Turning it on is the owner's one approval of those rules; it needs the two-step code (the screen says so if it is missing) and is audited. Only the Owner changes it;
 * the rest read. The state shown is what the API answered.
 */
export function AutoReply({ words, initial, canEdit, change, securityHref }: { words?: Words; initial: State; canEdit: boolean; change: (enabled: boolean) => Promise<Out>; securityHref: string }) {
  const t = makeT(words);
  const [state, setState] = React.useState(initial);
  const [error, setError] = React.useState<AutoReplyError | null>(null);
  const [busy, startChange] = React.useTransition();
  const [done, setDone] = React.useState(false);
  const flip = () =>
    startChange(async () => {
      setError(null);
      setDone(false);
      const r = await change(!state.enabled);
      if (r.ok) {
        setState(r.data);
        setDone(true);
      } else setError(r.error);
    });
  return (
    <section className={`${surface} flex flex-col gap-3`} aria-labelledby="ar-h" data-part="auto-reply">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="ar-h" className="text-lg font-semibold text-ink">{t("ar.title")}</h2>
        <span data-state={state.enabled ? "on" : "off"} className={`rounded-full px-3 py-1 text-xs font-semibold ${state.enabled ? "bg-green-bg text-green-text" : "bg-surface-2 text-muted"}`}>{t(state.enabled ? "ar.on" : "ar.off")}</span>
      </div>
      <p className="text-sm text-muted">{t("ar.what")}</p>
      {state.rules.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-ink">{t("ar.rules")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {state.rules.map((r) => (
              <li key={r}>{t(`ar.rule.${r}` as "ar.rule.answers_within_24_hours")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {state.enabled ? <p className="text-sm text-ink" data-part="auto-reply-today">{t("ar.today", { answered: state.answeredToday, held: state.heldToday, limit: state.dailyLimit })}</p> : null}
      <p className={fieldHelp}>{t("ar.needs")}</p>
      {canEdit ? (
        <div className="flex flex-col gap-2">
          {!state.enabled ? <p className="text-sm text-muted">{t("ar.approve")}</p> : null}
          <div>
            <button type="button" className={state.enabled ? btnQuiet : btnMain} disabled={busy} onClick={flip}>
              {t(state.enabled ? "ar.turnoff" : "ar.turnon")}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("ar.owneronly")}</p>
      )}
      {error ? (
        <p role="alert" className={alertBox}>
          {t(`ar.err.${error}` as "ar.err.down")}
          {error === "mfa" ? (
            <>
              {" "}
              <a href={securityHref} className="font-semibold underline">
                {t("today.err.mfa.link")}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {done ? <p role="status" className={okBox}>{t(state.enabled ? "ar.done.on" : "ar.done.off")}</p> : null}
    </section>
  );
}
