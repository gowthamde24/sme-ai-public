"use client";

import { Check, MessageCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { makeT, type Words } from "../../../words";
import { LazyLiveBar } from "../LazyLiveBar";
import { OrbRing } from "../OrbRing";
import { STEP_IDS, TOTAL_MINUTES, type StepView } from "./steps";

export type DayOneActions = {
  /** "Skip for now": the checklist is put away, Today shows the "Finish setup" chip. */
  skip: () => Promise<void>;
  /** "Go live with defaults". Resolves with what is still missing (the page refreshes by itself when it went live). */
  goLive: () => Promise<{ ok: boolean; missing: readonly ("business_name" | "phone_number")[] }>;
  /** Staging only (mock): connects a made-up test number so Go live can be tried. null = not offered. */
  testNumber: (() => Promise<void>) | null;
};

/** The progress ring: a circle that fills with the steps done, with "2/7" and "steps done" in the middle. */
export function ProgressRing({ done, total, label = "" }: { done: number; total: number; label?: string }) {
  const r = 80;
  const c = 2 * Math.PI * r;
  return (
    <svg data-part="progress-ring" role="img" aria-label={`${done}/${total}`} viewBox="0 0 200 200" className="mx-auto size-[190px] shrink-0">
      <circle cx="100" cy="100" r={r} fill="none" strokeWidth="14" className="stroke-surface-2" />
      <circle cx="100" cy="100" r={r} fill="none" strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} transform="rotate(-90 100 100)" className="stroke-brand" />
      <text x="100" y="108" textAnchor="middle" className="fill-ink font-display text-[44px] font-extrabold">
        {done}/{total}
      </text>
      {label ? (
        <text x="100" y="132" textAnchor="middle" className="fill-muted text-[14px]">
          {label}
        </text>
      ) : null}
    </svg>
  );
}

/**
 * Day one (design system v6, owner 13 Nov 2026): until the assistant is live, Today shows this instead of the command band. "Welcome, <name>. Let's get your assistant ready. About 15 minutes." with the seven steps (time estimates; the done ones ticked, the current one
 * highlighted with "Start", the middle three marked "Optional · defaults are set"); on the right the progress ring and "Continue setup", "Not sure? Just talk." (the same live conversation as the command bar, in place) and "Need help?" (WhatsApp support); under it an empty state
 * with "Make a test call". "Skip for now" is under the headline. "Go live with defaults" shows once a business name and a connected phone number are done; before that the Go live button says what is missing. It is a lazy chunk: Today's first paint does not carry it.
 */
export default function DayOne({ name, steps, canGoLive, missing, actions, words, language, helpHref, testCallHref }: { name: string; steps: readonly StepView[]; canGoLive: boolean; missing: readonly ("business_name" | "phone_number")[]; actions: DayOneActions; words: Words; language: string; helpHref: string; testCallHref: string }) {
  const t = makeT(words);
  const done = steps.filter((s) => s.done).length;
  const current = steps.find((s) => s.current) ?? null;
  const [talk, setTalk] = React.useState(false);
  const [explain, setExplain] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [still, setStill] = React.useState<readonly string[] | null>(null);
  const need = still ?? missing;
  const go = async () => {
    setBusy(true);
    try {
      const r = await actions.goLive();
      if (!r.ok) setStill(r.missing);
    } finally {
      setBusy(false);
    }
  };
  const card = "rounded-[22px] border border-line bg-surface shadow-[var(--v2-shadow)]";
  return (
    <div data-part="day-one" className="flex flex-col gap-5">
      <section className="ds-band grid min-w-0 items-start gap-[26px] rounded-[30px] border border-line p-[22px] lg:grid-cols-[minmax(0,1fr)_380px] lg:p-[26px_28px_24px]">
        <div className="min-w-0">
          <header className="flex flex-col">
            <h2 className="font-display text-[28px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[34px]">{t("tv6.d1.welcome", { name })}</h2>
            <p className="mt-1.5 text-sm text-muted">
              {t("tv6.d1.about", { n: TOTAL_MINUTES })} {t("tv6.d1.about.more")}
            </p>
            <form action={actions.skip} className="mt-1 self-start">
              <button type="submit" data-part="skip" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-brand-text underline-offset-4 hover:underline">
                {t("tv6.d1.skip")}
              </button>
            </form>
          </header>
          <ol data-part="steps" className="mt-2 flex flex-col gap-3">
            {steps.map((s, i) => (
              <li key={s.id} data-step={s.id} data-state={s.done ? "done" : s.current ? "current" : "todo"} aria-current={s.current ? "step" : undefined} className={`flex flex-wrap items-center gap-3.5 rounded-2xl border bg-surface px-[18px] py-3.5 ${s.current ? "border-brand-edge" : "border-line"}`}>
                <span aria-hidden="true" className={`grid size-[42px] shrink-0 place-items-center rounded-full text-[15px] font-bold ${s.done ? "bg-green-bg text-green-text" : s.current ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"}`}>
                  {s.done ? <Check className="size-5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className={`text-base font-bold ${s.done ? "text-muted line-through" : ""}`}>
                    {s.done ? (
                      <>
                        {t(`tv6.d1.step.${s.id}`)}
                        <span className="sr-only"> · {t("tv6.d1.done")}</span>
                      </>
                    ) : (
                      <Link href={s.href} className="hover:underline">
                        {t(`tv6.d1.step.${s.id}`)}
                      </Link>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {t(`tv6.d1.desc.${s.id}`)}
                    {s.optional ? <> · {t("tv6.d1.optional")}</> : null}
                  </p>
                </div>
                {s.current ? (
                  <Link href={s.href} className="inline-flex min-h-11 items-center rounded-[10px] border border-brand-edge bg-brand px-4 text-sm font-bold text-on-brand hover:brightness-95">
                    {t("tv6.d1.start")}
                  </Link>
                ) : (
                  <span className="shrink-0 text-sm text-muted">{t("tv6.d1.min", { n: s.minutes })}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <aside data-part="day-one-side" className="flex min-w-0 flex-col gap-4">
          <div className={`${card} flex flex-col gap-3 p-6 text-center`}>
            <ProgressRing done={done} total={STEP_IDS.length} label={t("tv6.d1.steps_done")} />
            <span className="sr-only">{t("tv6.d1.progress", { done, total: STEP_IDS.length })}</span>
            {current ? (
              <>
                <p className="font-display text-2xl font-extrabold tracking-[-0.5px]">{t("tv6.d1.next", { step: t(`tv6.d1.step.${current.id}`) })}</p>
                <p className="text-sm text-muted">{t(`tv6.d1.desc.${current.id}`)}</p>
                <Link href={current.href} className="ds-do w-full">
                  {t("tv6.d1.continue")}
                </Link>
              </>
            ) : null}
            {canGoLive ? (
              <button type="button" data-part="go-live" disabled={busy} onClick={() => void go()} className={current ? "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-bold text-ink hover:bg-surface disabled:opacity-60" : "ds-do w-full"}>
                {t("tv6.d1.golive")}
              </button>
            ) : (
              <>
                <button type="button" data-part="go-live" aria-disabled="true" aria-expanded={explain} onClick={() => setExplain((v) => !v)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-bold text-ink opacity-70">
                  {t("tv6.d1.golive.short")}
                </button>
                {explain ? (
                  <p role="status" data-part="go-live-missing" className="text-sm text-muted">
                    {t("tv6.d1.golive.missing", { what: need.map((m) => t(`tv6.d1.missing.${m}`)).join(` ${t("tv6.d1.and")} `) })}
                  </p>
                ) : null}
              </>
            )}
            {still && still.length > 0 && canGoLive ? (
              <p role="status" className="text-sm text-muted">
                {t("tv6.d1.golive.missing", { what: still.map((m) => t(`tv6.d1.missing.${m}`)).join(` ${t("tv6.d1.and")} `) })}
              </p>
            ) : null}
            {actions.testNumber && !canGoLive ? (
              <form action={actions.testNumber}>
                <button type="submit" data-part="test-number" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-brand-text underline-offset-4 hover:underline">
                  {t("tv6.d1.testnumber")}
                </button>
              </form>
            ) : null}
          </div>
          <div data-part="just-talk" className={`${card} flex flex-col gap-3 p-4`}>
            {talk ? (
              <LazyLiveBar kind="setup" words={words} language={language} onClose={() => setTalk(false)} />
            ) : (
              <div className="flex items-center gap-3.5">
                <button type="button" onClick={() => setTalk(true)} aria-label={t("dst.talk_live")} className="shrink-0 rounded-full focus-visible:outline-2">
                  <OrbRing size="md" state="ambient" />
                </button>
                <div className="min-w-0">
                  <p className="text-base font-bold">{t("tv6.d1.talk.title")}</p>
                  <p className="text-[13px] text-muted">{t("tv6.d1.talk.text")}</p>
                </div>
              </div>
            )}
          </div>
          <div className={`${card} flex items-center gap-3.5 p-4`}>
            <MessageCircle className="size-8 shrink-0 text-ink" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-base font-bold">{t("tv6.d1.help")}</p>
              <Link href={helpHref} className="text-[13px] text-muted hover:underline">
                {t("tv6.d1.help.link")}
              </Link>
            </div>
          </div>
        </aside>
      </section>
      <section data-part="empty-next" className={`${card} flex flex-wrap items-center gap-3 px-[22px] py-4`}>
        <span aria-hidden="true" className="text-xl">📪</span>
        <p className="min-w-0 flex-1 basis-60 text-[15px]">
          <b>{t("tv6.d1.empty.title")}</b> <span className="text-muted">{t("tv6.d1.empty.text")}</span>
        </p>
        <Link href={testCallHref} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
          {t("tv6.d1.empty.action")}
        </Link>
      </section>
    </div>
  );
}
