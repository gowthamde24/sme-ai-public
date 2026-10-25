"use client";

import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import { connectionState, type WhatsappAccount } from "@/lib/api/whatsapp";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, h3, help, label as labelClass, okLine, pillClass, primary, secondary, type Failed } from "../cc/kit";
import { OrbMark } from "../mark/OrbMark";
import { makeT, type Words } from "../words";
import { accountProblem, STATE_MOOD, STATE_TONE, waSentence } from "./wa-model";
import type { AccountActions } from "./wa-types";

/**
 * Connect WhatsApp (job CC, screen 5): the business's number in four states (not connected, connecting, connected, needs attention) and the few details that connect it. The Owner saves the details (with the second factor),
 * switches the number on and off; an Admin only reads. The access key itself is never typed here: the page takes the NAME of a key that the person who runs the system has put on the server, and says when the server
 * does not have it. This page records the number; whether messages really reach WhatsApp depends on how the system was set up (a test system sends to a stand-in, never to customers).
 */
export function ConnectWhatsapp({ words, account: initial, canEdit, actions }: { words: Words; account: WhatsappAccount; canEdit: boolean; actions: AccountActions }) {
  const t = makeT(words);
  const id = useId();
  const [account, setAccount] = useState(initial);
  const first = account.configured ? account : null;
  const [form, setForm] = useState({ wabaId: first?.waba_id ?? "", phoneNumberId: first?.phone_number_id ?? "", displayPhone: first?.display_phone ?? "", coexistence: first?.coexistence ?? false, tokenRef: first?.token_ref ?? "" });
  const [busy, setBusy] = useState<"save" | "on" | "off" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const { state, why } = connectionState(account);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === "coexistence" ? e.target.checked : e.target.value });

  async function run(kind: "save" | "on" | "off") {
    setFailure(null);
    setSaid(null);
    if (kind === "save") {
      const p = accountProblem(form);
      setProblem(p ? t(`wa.form.bad.${p}`) : null);
      if (p) return;
    }
    setBusy(kind);
    const r = await (kind === "save" ? actions.save(form) : kind === "on" ? actions.activate() : actions.disable());
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setAccount(r.data);
    setSaid(t(kind === "save" ? "wa.said.saved" : kind === "on" ? "wa.said.on" : "wa.said.off"));
  }

  return (
    <div className="flex flex-col gap-5" data-whatsapp="connect">
      <section className={card} aria-labelledby={`${id}-state`} data-wa-state={state}>
        <div className="flex items-start gap-3">
          <OrbMark px={56} mood={STATE_MOOD[state]} className="size-14" />
          <div className="min-w-0">
            <h2 id={`${id}-state`} className={h2}>
              {t("wa.state.title")}
            </h2>
            <p className="mt-1">
              <span className={pillClass(STATE_TONE[state])}>{t(`wa.state.${state}`)}</span>
            </p>
          </div>
        </div>
        <p className="text-base">{t(why ? `wa.state.${state}.${why}` : `wa.state.${state}.body`, { phone: first?.display_phone ?? first?.phone_number_id ?? "", ref: first?.token_ref ?? "" })}</p>
        {first?.updated_at ? (
          <p className={help}>
            {t("wa.state.updated")} <LocalTime iso={first.updated_at} />
          </p>
        ) : null}
        <p className={help}>{t("wa.fake_note")}</p>
        {canEdit && first ? (
          <div className="flex flex-wrap gap-3">
            {first.status !== "active" ? (
              <button key="on" type="button" onClick={() => run("on")} disabled={busy !== null || !first.token_available} className={primary}>
                {busy === "on" ? t("dta.btn.working") : t("wa.btn.on")}
              </button>
            ) : (
              <button key="off" type="button" onClick={() => run("off")} disabled={busy !== null} className={secondary}>
                {busy === "off" ? t("dta.btn.working") : t("wa.btn.off")}
              </button>
            )}
          </div>
        ) : null}
        {said ? (
          <p role="status" className={okLine}>
            {said}
          </p>
        ) : null}
      </section>

      {canEdit ? (
        <section className={card} aria-labelledby={`${id}-form`}>
          <h2 id={`${id}-form`} className={h2}>
            {t("wa.form.title")}
          </h2>
          <ol className="list-decimal pl-5 text-base text-muted">
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>{t(`wa.steps.${n}`)}</li>
            ))}
          </ol>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run("save");
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-waba`} className={labelClass}>
                  {t("wa.form.waba")}
                </label>
                <input id={`${id}-waba`} value={form.wabaId} onChange={set("wabaId")} inputMode="numeric" autoComplete="off" className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-pn`} className={labelClass}>
                  {t("wa.form.phone_id")}
                </label>
                <input id={`${id}-pn`} value={form.phoneNumberId} onChange={set("phoneNumberId")} inputMode="numeric" autoComplete="off" className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-shown`} className={labelClass}>
                  {t("wa.form.shown")}
                </label>
                <input id={`${id}-shown`} value={form.displayPhone} onChange={set("displayPhone")} autoComplete="off" className={field} />
              </div>
              <div>
                <label htmlFor={`${id}-ref`} className={labelClass}>
                  {t("wa.form.key_name")}
                </label>
                <input id={`${id}-ref`} value={form.tokenRef} onChange={set("tokenRef")} autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
                <p className={help}>{t("wa.form.key_help")}</p>
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" checked={form.coexistence} onChange={set("coexistence")} className="size-6 shrink-0 accent-brand-text" />
              {t("wa.form.coexistence")}
            </label>
            {problem ? (
              <p role="alert" className="text-sm font-medium text-red-text">
                {problem}
              </p>
            ) : null}
            <p className={help}>{t("wa.form.mfa")}</p>
            <FailureNote failure={failure} words={words} own={(code) => waSentence(code, t)} />
            <div>
              <button type="submit" disabled={busy !== null} className={primary}>
                {busy === "save" ? t("dta.btn.working") : t("wa.btn.save")}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className={card}>
          <h3 className={h3}>{t("wa.form.title")}</h3>
          <p className="text-base text-muted">{t("wa.owner_only")}</p>
          <FailureNote failure={failure} words={words} />
        </section>
      )}
    </div>
  );
}
