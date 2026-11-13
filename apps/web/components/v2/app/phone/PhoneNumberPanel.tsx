"use client";

import * as React from "react";

import { CITIES, STEPS, type City, type PhoneNumber, type Step } from "@/lib/phone-number/types";

import { btnMain, btnQuiet, fieldHelp, okBox, alertBox, warnBox, tileCard } from "../ui";
import { makeT, type Words } from "../words";

type Answer = { ok: true; data: PhoneNumber; message?: string } | { ok: false; error: string };
export type PhoneActions = { request: (city: City) => Promise<Answer>; approve: (step: Step) => Promise<Answer>; release: () => Promise<Answer> };
const chip = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;

/**
 * Settings > Phone number (job B6, TEST screen): not set up -> pick a city -> the number is reserved and the approval steps wait -> every step approved -> active, with "Ring my phone to test". The numbers are made up (+00 ...), nothing is bought, rented or rung, and the screen says so.
 * Only the Owner changes anything (`canEdit`). The state shown is always what the server answered.
 */
export function PhoneNumberPanel({ words, initial, canEdit, mock, actions }: { words?: Words; initial: PhoneNumber; canEdit: boolean; mock: boolean; actions: PhoneActions }) {
  const t = makeT(words);
  const [phone, setPhone] = React.useState(initial);
  const [city, setCity] = React.useState<City>(initial.city ?? "hyderabad");
  const [sure, setSure] = React.useState(false);
  const [tested, setTested] = React.useState(false);
  const [busy, start] = React.useTransition();
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);

  const move = (call: () => Promise<Answer>) =>
    start(async () => {
      setNote(null);
      const out = await call().catch(() => ({ ok: false as const, error: t("phone.err.generic") }));
      if (out.ok) {
        setPhone(out.data);
        setSure(false);
        setTested(false);
        if (out.message) setNote({ ok: true, text: out.message });
      } else setNote({ ok: false, text: out.error });
    });

  return (
    <section aria-labelledby="phone-status" data-part="phone-number" data-phone-state={phone.state} className={`${tileCard} max-w-2xl`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="phone-status" className="font-display text-xl font-semibold">
          {t("phone.status.title")}
        </h2>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${phone.state === "active" ? "bg-brand-bg text-brand-text" : "bg-surface-2 text-muted"}`}>
          {phone.state === "not_set_up" ? t("phone.status.none") : phone.state === "kyc_pending" ? t("phone.state.kyc_pending") : t("phone.state.active")}
        </span>
      </div>
      {mock ? <p className={warnBox} data-part="phone-mock">{t("phone.mock")}</p> : null}
      {canEdit ? null : <p className={fieldHelp}>{t("phone.owneronly")}</p>}

      {phone.state === "not_set_up" ? (
        <div className="flex flex-col gap-3" data-part="phone-pick">
          <p className="text-base text-muted">{t("phone.status.body")}</p>
          <div role="group" aria-label={t("phone.city.title")} className="flex flex-wrap gap-2">
            {CITIES.map((c) => (
              <button key={c} type="button" aria-pressed={c === city} disabled={!canEdit || busy} onClick={() => setCity(c)} className={chip(c === city)}>
                {t(`phone.city.${c}` as "phone.city.hyderabad")}
              </button>
            ))}
          </div>
          <p className={fieldHelp} data-part="phone-cost">{t("phone.cost")}</p>
          {canEdit ? (
            <div>
              <button type="button" disabled={busy} onClick={() => move(() => actions.request(city))} className={btnMain}>
                {t("phone.get")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base">
            <span className="text-muted">{t("phone.number.label")}: </span>
            <strong data-part="phone-digits" className="font-mono text-lg">{phone.number}</strong> · {t(`phone.city.${phone.city}` as "phone.city.hyderabad")}
          </p>
          {phone.state === "kyc_pending" ? (
            <div data-part="phone-kyc">
              <h3 className="font-semibold">{t("phone.kyc.title")}</h3>
              <p className={fieldHelp}>{t("phone.kyc.sub")}</p>
              <ul className="mt-2 flex flex-col gap-2">
                {STEPS.map((s) => {
                  const done = phone.done.includes(s);
                  return (
                    <li key={s} data-step={s} data-done={done} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2">
                      <span className="min-w-0 flex-1">{t(`phone.step.${s}` as "phone.step.business_proof")}</span>
                      <span className="text-sm font-semibold text-muted">{done ? t("phone.step.done") : t("phone.step.waiting")}</span>
                      {mock && canEdit && !done ? (
                        <button type="button" disabled={busy} onClick={() => move(() => actions.approve(s))} className={btnQuiet}>
                          {t("phone.step.mark")}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-part="phone-active">
              <div>
                <button type="button" disabled={tested} onClick={() => setTested(true)} className={btnQuiet}>
                  {t("phone.test")}
                </button>
              </div>
              {tested ? <p role="status" className={fieldHelp}>{mock ? t("phone.test.mock") : t("phone.test.sent")}</p> : null}
            </div>
          )}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-3" data-part="phone-release">
              {sure ? (
                <>
                  <p className="text-sm text-muted">{t("phone.release.note")}</p>
                  <button type="button" disabled={busy} onClick={() => move(() => actions.release())} className={btnMain}>
                    {t("phone.release.yes")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setSure(false)} className={btnQuiet}>
                    {t("today.act.cancel")}
                  </button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => setSure(true)} className={btnQuiet}>
                  {t("phone.release")}
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
      {note ? <p role={note.ok ? "status" : "alert"} className={note.ok ? okBox : alertBox}>{note.text}</p> : null}
    </section>
  );
}
