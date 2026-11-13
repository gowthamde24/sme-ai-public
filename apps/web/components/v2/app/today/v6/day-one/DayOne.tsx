"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";

import { EmptyNext } from "../../../ds/EmptyNext";
import { btnMain, btnQuiet } from "../../../ui";
import { makeT, type Words } from "../../../words";
import { LazyLiveBar } from "../LazyLiveBar";
import { STEP_IDS, TOTAL_MINUTES, type StepView } from "./steps";

export type DayOneActions = {
  /** "Skip for now": the checklist is put away, Today shows the "Finish setup" chip. */
  skip: () => Promise<void>;
  /** "Go live with defaults". Resolves with what is still missing (the page refreshes by itself when it went live). */
  goLive: () => Promise<{ ok: boolean; missing: readonly ("business_name" | "phone_number")[] }>;
  /** Staging only (mock): connects a made-up test number so Go live can be tried. null = not offered. */
  testNumber: (() => Promise<void>) | null;
};

/** The progress ring: a circle that fills with the steps done, and "3/7" in the middle. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg data-part="progress-ring" role="img" aria-label={`${done}/${total}`} viewBox="0 0 80 80" className="size-20 shrink-0">
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-line" />
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - done / total)} transform="rotate(-90 40 40)" className="stroke-brand" />
      <text x="40" y="46" textAnchor="middle" className="fill-ink text-xl font-semibold">
        {done}/{total}
      </text>
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
  return (
    <div data-part="day-one" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-[28px] font-semibold leading-[1.1] md:text-[32px]">{t("tv6.d1.welcome", { name })}</h2>
        <p className="text-base text-muted">{t("tv6.d1.about", { n: TOTAL_MINUTES })}</p>
        <form action={actions.skip} className="mt-1 self-start">
          <button type="submit" data-part="skip" className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-brand-text underline-offset-4 hover:underline">
            {t("tv6.d1.skip")}
          </button>
        </form>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ol data-part="steps" className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-[var(--v2-shadow)]">
          {steps.map((s, i) => (
            <li key={s.id} data-step={s.id} data-state={s.done ? "done" : s.current ? "current" : "todo"} aria-current={s.current ? "step" : undefined} className={`flex flex-wrap items-center gap-3 rounded-xl p-3 ${s.current ? "border border-brand-edge bg-brand-bg" : "border border-transparent"}`}>
              <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold ${s.done ? "bg-brand text-on-brand" : "border border-edge bg-surface text-muted"}`}>
                {s.done ? <Check className="size-5" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
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
                  {t("tv6.d1.min", { n: s.minutes })}
                  {s.optional ? <> · {t("tv6.d1.optional")}</> : null}
                </p>
              </div>
              {s.current ? (
                <Link href={s.href} className={`${btnMain} min-h-11 px-5`}>
                  {t("tv6.d1.start")}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
        <aside data-part="day-one-side" className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
            <div className="flex items-center gap-4">
              <ProgressRing done={done} total={STEP_IDS.length} />
              <p className="text-base font-semibold">{t("tv6.d1.progress", { done, total: STEP_IDS.length })}</p>
            </div>
            {current ? (
              <Link href={current.href} className={`${btnMain} min-h-11`}>
                {t("tv6.d1.continue")}
              </Link>
            ) : null}
            {canGoLive ? (
              <button type="button" data-part="go-live" disabled={busy} onClick={() => void go()} className={`${current ? btnQuiet : btnMain} min-h-11`}>
                {t("tv6.d1.golive")}
              </button>
            ) : (
              <>
                <button type="button" data-part="go-live" aria-disabled="true" aria-expanded={explain} onClick={() => setExplain((v) => !v)} className={`${btnQuiet} min-h-11 opacity-70`}>
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
                <button type="submit" data-part="test-number" className="inline-flex min-h-11 items-center rounded-lg px-1 text-sm font-semibold text-brand-text underline-offset-4 hover:underline">
                  {t("tv6.d1.testnumber")}
                </button>
              </form>
            ) : null}
          </div>
          <div data-part="just-talk" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)]">
            {talk ? (
              <LazyLiveBar kind="setup" words={words} language={language} onClose={() => setTalk(false)} />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Orb px={48} state="ambient" />
                  <p className="text-base font-semibold">{t("tv6.d1.talk.title")}</p>
                </div>
                <p className="text-sm text-muted">{t("tv6.d1.talk.text")}</p>
                <button type="button" onClick={() => setTalk(true)} className={`${btnQuiet} min-h-11`}>
                  ▶ {t("dst.talk_live")}
                </button>
              </>
            )}
          </div>
          <p className="text-sm">
            <span className="font-semibold">{t("tv6.d1.help")}</span>{" "}
            <Link href={helpHref} className="font-semibold text-brand-text underline-offset-4 hover:underline">
              {t("tv6.d1.help.link")}
            </Link>
          </p>
        </aside>
      </div>
      <EmptyNext title={t("tv6.d1.empty.title")} text={t("tv6.d1.empty.text")} action={{ href: testCallHref, label: t("tv6.d1.empty.action") }} />
    </div>
  );
}
