"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { MAX_QUESTIONS, PRICE_OR_PROMISE, type PDone, type PlaybookBody, type PlaybookQuestion, type PlaybookRead } from "@/lib/lead-desk/playbook";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldLabel, fieldTextarea, formStack, mutedText, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Step 3 of the Lead Desk setup, "Goal and questions" (night 4, part A2): the goal sentence and the questions Vijaya asks, taken from the template of this kind of business and editable (at most 8; each names one field of your
 * customer record). The objections, follow-up timings and safety rules are shown, not edited here. A goal or a question states no price and no promise (prices only come from the facts you approve). Only the Owner saves, with the second factor.
 */
export type PlaybookActions = { save: (input: unknown) => Promise<PDone<PlaybookRead>>; reset: () => Promise<PDone<PlaybookRead>> };

export function PlaybookStep({ words, read, canEdit, actions, securityHref, nextHref, fieldNames }: { words: Words; read: PlaybookRead; canEdit: boolean; actions: PlaybookActions; securityHref: string; nextHref: string; /** The customer-record fields by code, in the person's language. */ fieldNames: Readonly<Record<string, string>> }) {
  const t = makeT(words);
  const router = useRouter();
  const body = read.playbook as PlaybookBody;
  const defaults = read.defaults ?? body;
  const [goal, setGoal] = React.useState(body.goalAsk);
  const [questions, setQuestions] = React.useState<PlaybookQuestion[]>(() => [...body.questions]);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<null | { kind: "ok" | "error"; text: string; mfa?: boolean }>(null);
  const unused = defaults.questions.filter((d) => !questions.some((q) => q.field === d.field));
  const priced = PRICE_OR_PROMISE.test(goal) || questions.some((q) => PRICE_OR_PROMISE.test(q.ask));
  const set = (i: number, patch: Partial<PlaybookQuestion>) => setQuestions((cur) => cur.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQuestions((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const finish = (out: PDone<PlaybookRead>, ok: string) => {
    setBusy(false);
    if (out.ok) {
      const b = out.value.playbook;
      if (b) {
        setGoal(b.goalAsk);
        setQuestions([...b.questions]);
      }
      setNote({ kind: "ok", text: ok });
      router.refresh();
    } else setNote({ kind: "error", text: t(`ld.p.err.${out.error}` as "ld.p.err.down"), mfa: out.error === "mfa" });
  };
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setNote(null);
    finish(await actions.save({ goalAsk: goal, questions }).catch((): PDone<PlaybookRead> => ({ ok: false, error: "down" })), t("ld.p.saved"));
  };
  const reset = async () => {
    setBusy(true);
    setNote(null);
    finish(await actions.reset().catch((): PDone<PlaybookRead> => ({ ok: false, error: "down" })), t("ld.p.reset.done"));
  };

  return (
    <div data-part="playbook" className="flex flex-col gap-5">
      <p className="text-base">{t("ld.p.intro")}</p>
      <form onSubmit={save} className={`${surface} ${formStack}`}>
        <div>
          <label htmlFor="p-goal" className={fieldLabel}>
            {t("ld.p.goal")}
          </label>
          <textarea id="p-goal" className={fieldTextarea} rows={2} maxLength={400} disabled={!canEdit || busy} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </div>
        <fieldset className="flex flex-col gap-3" disabled={!canEdit || busy}>
          <legend className={fieldLabel}>{t("ld.p.questions", { n: questions.length, max: MAX_QUESTIONS })}</legend>
          {questions.map((q, i) => (
            <div key={q.field} data-question={q.field} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <p className="text-sm font-semibold text-muted">{fieldNames[q.field] ?? q.field}</p>
              <label htmlFor={`p-q-${q.field}`} className="sr-only">
                {fieldNames[q.field] ?? q.field}
              </label>
              <textarea id={`p-q-${q.field}`} className={fieldTextarea} rows={2} maxLength={400} value={q.ask} onChange={(e) => set(i, { ask: e.target.value })} />
              <label className="flex min-h-11 items-center gap-3 text-base">
                <input type="checkbox" className="size-6 accent-brand-text" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} />
                {t("ld.p.required")}
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnQuiet} disabled={i === 0} aria-label={t("ld.p.up")} onClick={() => move(i, -1)}>
                  {t("ld.p.up")}
                </button>
                <button type="button" className={btnQuiet} disabled={i === questions.length - 1} aria-label={t("ld.p.down")} onClick={() => move(i, 1)}>
                  {t("ld.p.down")}
                </button>
                <button type="button" className={btnQuiet} disabled={questions.length <= 1} onClick={() => setQuestions((cur) => cur.filter((_, j) => j !== i))}>
                  {t("ld.p.remove")}
                </button>
              </div>
            </div>
          ))}
          {unused.length > 0 && questions.length < MAX_QUESTIONS ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-muted">{t("ld.p.add")}</span>
              {unused.map((d) => (
                <button key={d.field} type="button" className={btnQuiet} onClick={() => setQuestions((cur) => [...cur, { ...d }])}>
                  {fieldNames[d.field] ?? d.field}
                </button>
              ))}
            </div>
          ) : null}
        </fieldset>
        {priced ? (
          <p role="alert" className={`${alertBox} !mt-0`}>
            {t("ld.p.err.price_or_promise")}
          </p>
        ) : null}
        <p className={fieldHelp}>{t("ld.p.help")}</p>
        {canEdit ? (
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={btnMain} disabled={busy || priced || goal.trim().length < 5 || questions.length === 0}>
              {busy ? t("ld.p.saving") : t("ld.p.save")}
            </button>
            {read.saved ? (
              <button type="button" className={btnQuiet} disabled={busy} onClick={() => void reset()}>
                {t("ld.p.reset")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className={`${mutedText} !mt-0`}>{t("ld.p.owner")}</p>
        )}
      </form>
      {note ? (
        <p role={note.kind === "ok" ? "status" : "alert"} className={`${note.kind === "ok" ? okBox : alertBox} !mt-0`}>
          {note.text}{" "}
          {note.mfa ? (
            <Link href={securityHref} className="font-semibold underline">
              {t("pc.err.mfa.link")}
            </Link>
          ) : null}
        </p>
      ) : null}

      {body.objections.length > 0 ? (
        <section className={surface} aria-labelledby="p-obj-h">
          <h3 id="p-obj-h" className="font-display text-lg font-bold">
            {t("ld.p.objections")}
          </h3>
          <ul className="mt-2 flex flex-col gap-3">
            {body.objections.map((o) => (
              <li key={o.code}>
                <p className="text-sm font-semibold text-muted">{t("ld.p.hears", { words: o.hears.join(", ") })}</p>
                <p className="break-words">{o.answer}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {body.followups.length > 0 ? (
        <section className={surface} aria-labelledby="p-fu-h">
          <h3 id="p-fu-h" className="font-display text-lg font-bold">
            {t("ld.p.followups")}
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {body.followups.map((f, i) => (
              <li key={i} className="text-base">
                {t(`ld.p.when.${f.when}` as "ld.p.when.other")} · {f.afterMinutes < 0 ? t("ld.p.before", { n: Math.abs(f.afterMinutes) }) : t("ld.p.after", { n: f.afterMinutes })} · {t(`pc.channel.${f.channel === "whatsapp" ? "whatsapp" : "call"}` as "pc.channel.call")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {read.safety.length > 0 ? (
        <section className={surface} aria-labelledby="p-safe-h">
          <h3 id="p-safe-h" className="font-display text-lg font-bold">
            {t("ld.p.safety")}
          </h3>
          <ul className="mt-2 list-inside list-disc text-base">
            {read.safety.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className={`${mutedText} !mt-1`}>{t("ld.p.safety.help")}</p>
        </section>
      ) : null}
      <div>
        <Link href={nextHref} className={btnMain}>
          {t("ld.wiz.next")}
        </Link>
      </div>
    </div>
  );
}
