"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { LocalTime } from "@/app/app/local-time";
import { connectionState, type Connected, type ConnectConfig, type ConnectInput, type WhatsappAccount } from "@/lib/api/whatsapp";

import { FailureNote } from "../cc/FailureNote";
import { card, field, h2, h3, help, label as labelClass, okLine, pillClass, primary, secondary, type Failed } from "../cc/kit";
import { OrbMark } from "../mark/OrbMark";
import { ConnectWithFacebook } from "./LazyConnectWithFacebook";
import { makeT, type Words } from "../words";
import { accountProblem, STATE_MOOD, STATE_TONE, waSentence } from "./wa-model";
import type { AccountActions, Out } from "./wa-types";

/**
 * Connect WhatsApp (job CC, screen 5): the business's number in four states (not connected, connecting, connected, needs attention) and the few details that connect it. The Owner saves the details (with the second factor),
 * switches the number on and off; an Admin only reads. The access key itself is never typed here: the page takes the NAME of a key that the person who runs the system has put on the server, and says when the server
 * does not have it. This page records the number; whether messages really reach WhatsApp depends on how the system was set up (a test system sends to a stand-in, never to customers).
 */
/** `signup` = "Connect with Facebook": what the API said it needs (null = could not be told) and the action that records the result; absent = the card is not drawn at all (the manual form is then the only way). */
export type Signup = { config: ConnectConfig | null; connect: (f: ConnectInput) => Promise<Out<Connected>> };

export function ConnectWhatsapp({ words, account: initial, canEdit, actions, signup }: { words: Words; account: WhatsappAccount; canEdit: boolean; actions: AccountActions; signup?: Signup }) {
  const router = useRouter();
  const t = makeT(words);
  const id = useId();
  const [account, setAccount] = useState(initial);
  // the page was read again (router.refresh after a connect): take the new account, and forget what was only shown in the meantime
  const [seen, setSeen] = useState(initial);
  const [fresh, setFresh] = useState<Connected | null>(null);
  if (initial !== seen) {
    setSeen(initial);
    setAccount(initial);
    setFresh(null);
  }
  const [asking, setAsking] = useState(false);
  const first = account.configured ? account : null;
  const [form, setForm] = useState({ wabaId: first?.waba_id ?? "", phoneNumberId: first?.phone_number_id ?? "", displayPhone: first?.display_phone ?? "", coexistence: first?.coexistence ?? false, tokenRef: first?.token_ref ?? "" });
  const [busy, setBusy] = useState<"save" | "on" | "off" | "disconnect" | null>(null);
  const [failure, setFailure] = useState<Failed | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // a number just connected in Meta's window shows as Connected at once (the page is read again in the background)
  const { state: read, why: readWhy } = connectionState(account);
  const state = fresh ? "connected" : read;
  const why = fresh ? null : readWhy;
  const disconnected = account.configured && account.status === "disabled" && !fresh;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === "coexistence" ? e.target.checked : e.target.value });

  async function run(kind: "save" | "on" | "off" | "disconnect") {
    setFailure(null);
    setSaid(null);
    if (kind === "save") {
      const p = accountProblem(form);
      setProblem(p ? t(`wa.form.bad.${p}`) : null);
      if (p) return;
    }
    setBusy(kind);
    const r = await (kind === "save" ? actions.save(form) : kind === "on" ? actions.activate() : kind === "off" ? actions.disable() : actions.disconnect!());
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setAccount(r.data);
    setAsking(false);
    setFresh(null);
    setSaid(t(kind === "save" ? "wa.said.saved" : kind === "on" ? "wa.said.on" : kind === "off" ? "wa.said.off" : "wa.said.disconnected"));
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
        <p className="text-base">{t(why ? `wa.state.${state}.${why}` : `wa.state.${state}.body`, { phone: fresh?.displayPhone ?? first?.display_phone ?? first?.phone_number_id ?? "", ref: first?.token_ref ?? "" })}</p>
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
            {actions.disconnect && first.status !== "disabled" ? (
              <button key="disconnect" type="button" data-act="disconnect" onClick={() => setAsking(true)} disabled={busy !== null || asking} className={secondary}>
                {t("wa.btn.disconnect")}
              </button>
            ) : null}
          </div>
        ) : null}
        {asking ? (
          <div role="group" aria-label={t("wa.btn.disconnect")} data-part="disconnect-confirm" className="flex flex-col gap-2 border-y border-line py-3">
            <p className="m-0 text-base text-ink">{t("wa.disconnect.ask")}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" data-act="disconnect-yes" onClick={() => run("disconnect")} disabled={busy !== null} className={primary}>
                {busy === "disconnect" ? t("dta.btn.working") : t("wa.btn.disconnect")}
              </button>
              <button type="button" onClick={() => setAsking(false)} disabled={busy !== null} className={secondary}>
                {t("wa.disconnect.no")}
              </button>
            </div>
          </div>
        ) : null}
        {said ? (
          <p role="status" className={okLine}>
            {said}
          </p>
        ) : null}
      </section>

      {canEdit && signup && disconnected ? (
        <p role="status" data-part="reconnect-note" className="m-0 text-base text-ink">
          {t("wa.fb.disabled")}
        </p>
      ) : null}

      {canEdit && signup ? (
        signup.config?.available && signup.config.appId && signup.config.configId ? (
          <ConnectWithFacebook words={words} config={{ appId: signup.config.appId, configId: signup.config.configId, graphVersion: signup.config.graphVersion, coexistence: signup.config.onboardingTypes.includes("coexistence"), launchExtras: signup.config.launchExtras }} connect={signup.connect} onConnected={(c) => (setFresh(c), router.refresh())} />
        ) : (
          <section className={card} data-part="connect-facebook-soon">
            <h2 className={h2}>{t("wa.fb.title")}</h2>
            <p className="text-base text-muted">{t("wa.fb.soon")}</p>
          </section>
        )
      ) : null}

      {canEdit ? (
        <details className={card} data-part="manual-connect" open={!signup}>
          <summary className="cursor-pointer text-base font-semibold" data-part="manual-summary">
            {t("wa.fb.more")}
          </summary>
          <h2 id={`${id}-form`} className={`${h2} mt-3`}>
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
        </details>
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
