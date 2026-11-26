"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { primeAudio } from "@/lib/browser-voice/audio-io";

import { makeT, type Words } from "../../../words";
import { LazyLiveBar } from "../LazyLiveBar";
import { OrbRing } from "../OrbRing";
import type { DayOneActions } from "./DayOne";
import { STEP_IDS, TOTAL_MINUTES, type StepView } from "./steps";

/**
 * First day, the OPEN layout (owner, 25 Nov 2026; mock "First day"): one title and one sentence, "Skip for now" as a plain link, a thin one-line progress ("1 of 7 done"), the seven steps as hairline rows (a
 * grey tick when done, the CURRENT step bold with the ONE orange Start button, the others a grey time), a plain line with the small orb ("Not sure? Tap the orb ...") and a grey help line. No ring, no card, no
 * gradient, no second button for the same thing; "Go live with defaults" appears only when the last step is done. The words are the day-one words (`tv6.d1.*`); the actions are the boxed page's.
 */
export function DayOneOpen({ name, steps, canGoLive, actions, words, language, helpHref }: { name: string; steps: readonly StepView[]; canGoLive: boolean; missing: readonly ("business_name" | "phone_number")[]; actions: DayOneActions; words: Words; language: string; helpHref: string; testCallHref: string }) {
  const t = makeT(words);
  const done = steps.filter((s) => s.done).length;
  const total = STEP_IDS.length;
  const [talk, setTalk] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [still, setStill] = React.useState<readonly string[] | null>(null);
  const goLive = async () => {
    setBusy(true);
    try {
      const r = await actions.goLive();
      if (!r.ok) setStill(r.missing);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-part="day-one" data-open="day-one" className="mx-auto flex w-full max-w-3xl flex-col py-2">
      <h2 className="m-0 text-[26px] font-bold leading-tight text-ink md:text-[30px]">{t("tv6.d1.welcome", { name })}</h2>
      <p className="m-0 mt-1.5 text-[16px] text-muted">
        {t("tv6.d1.about", { n: TOTAL_MINUTES })} {t("tv6.d1.about.more")}
      </p>
      <form action={actions.skip} className="mt-1 self-start">
        <button type="submit" data-part="skip" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-muted underline underline-offset-4 hover:text-ink">
          {t("tv6.d1.skip")}
        </button>
      </form>
      <div data-part="progress" className="mt-3">
        <p className="m-0 text-[15px] font-semibold text-ink">{t("tv6.d1.progress", { done, total })}</p>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t("tv6.d1.progress", { done, total })} className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div data-fill={done} style={{ height: "100%", borderRadius: "9999px", background: "var(--v2-ink)", width: `${Math.round((done / total) * 100)}%` }} />
        </div>
      </div>
      <ol data-part="steps" className="m-0 mt-5 flex list-none flex-col border-t border-ink p-0">
        {steps.map((s, i) => (
          <li key={s.id} data-step={s.id} data-state={s.done ? "done" : s.current ? "current" : "todo"} aria-current={s.current ? "step" : undefined} className="flex items-center gap-4 border-b border-line py-4">
            <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center text-[15px] ${s.done ? "text-muted" : s.current ? "font-bold text-ink" : "text-muted"}`}>
              {s.done ? <Check className="size-5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`m-0 text-[17px] ${s.done ? "text-muted" : s.current ? "font-bold text-ink" : "font-semibold text-ink"}`}>
                {s.done ? (
                  <>
                    {t(`tv6.d1.step.${s.id}`)}
                    <span className="sr-only"> · {t("tv6.d1.done")}</span>
                  </>
                ) : (
                  <Link href={s.href} className="no-underline hover:underline">
                    {t(`tv6.d1.step.${s.id}`)}
                  </Link>
                )}
              </p>
              <p className="m-0 text-[15px] text-muted">
                {t(`tv6.d1.desc.${s.id}`)}
                {s.optional ? <> · {t("tv6.d1.optional")}</> : null}
              </p>
            </div>
            {s.current ? (
              <Link href={s.href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-brand-edge bg-brand px-5 text-[15px] font-semibold text-on-brand no-underline">
                {t("tv6.d1.start")}
              </Link>
            ) : s.done ? null : (
              <span className="shrink-0 text-[15px] text-muted">{t("tv6.d1.min", { n: s.minutes })}</span>
            )}
          </li>
        ))}
      </ol>
      {done === total && canGoLive ? (
        <div className="mt-5">
          <button type="button" data-part="go-live" disabled={busy} onClick={() => void goLive()} className="inline-flex min-h-11 items-center rounded-lg border border-brand-edge bg-brand px-5 text-[15px] font-semibold text-on-brand disabled:opacity-60">
            {t("tv6.d1.golive")}
          </button>
          {still && still.length > 0 ? (
            <p role="status" className="m-0 mt-2 text-[15px] text-muted">
              {t("tv6.d1.golive.missing", { what: still.map((m) => t(`tv6.d1.missing.${m}`)).join(` ${t("tv6.d1.and")} `) })}
            </p>
          ) : null}
        </div>
      ) : null}
      <div data-part="just-talk" className="mt-6 flex items-center gap-3.5">
        {talk ? (
          <div className="min-w-0 flex-1">
            <LazyLiveBar kind="setup" words={words} language={language} onClose={() => setTalk(false)} />
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                primeAudio(); // the microphone is asked for IN this tap
                setTalk(true);
              }}
              aria-label={t("dst.talk_live")}
              className="shrink-0 rounded-full round-ok focus-visible:outline-2"
            >
              <OrbRing size="sm" state="ambient" />
            </button>
            <p className="m-0 text-[15px] text-muted">{t("tv6.d1.talk.text")}</p>
          </>
        )}
      </div>
      <p className="m-0 mt-5 text-[15px] text-muted">
        {t("tv6.d1.help")}{" "}
        <Link href={helpHref} className="text-muted underline underline-offset-4 hover:text-ink">
          {t("tv6.d1.help.link")}
        </Link>
      </p>
    </section>
  );
}
