"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { LANGS, LANGUAGE_NAMES, type Lang } from "@/i18n/lang";
import { LANG_COOKIE, readLang, serializePreference } from "@/i18n/preferences";

import { Orb } from "@/components/v2/Orb";
import { orbStateOf } from "../mark/AgentMark";
import type { AiMood } from "../mark/mood";
import { say, type TodayWords } from "../today/today-words";
import { card, primary, quiet, secondary } from "../visits/styles";
import { HoursStep } from "./HoursStep";
import { SareeStep } from "./SareeStep";
import { NUMBERED, STEPS, type Local, type StepId } from "./setup-logic";
import type { SetupActions, SetupFacts } from "./types";
import type { Uploader } from "../catalogue/catalogue-types";
import type { preparePhoto } from "../catalogue/prepare-photo";

const MOOD: Record<StepId, AiMood> = { shop: "idle", hours: "listening", saree: "listening", agent: "answering", ready: "answering" };

/**
 * The first-run setup (job BJ): shown to the Owner of a brand-new workspace instead of an empty Today, until it is finished or skipped. One short step at a time (four, then "You're ready"), each one
 * saving through an API that already exists; a step can be skipped and the setup left ("Set up later") and picked up again from the checklist on Today. The step the person is on is remembered on this
 * device, so closing the tab and coming back resumes. Inviting the family is not a step: the API has no invitation route yet.
 */
export function SetupWizard({ base, lang, facts, local, words, actions, step, goTo, onSkip, onFinish, uploader, prepare }: { base: string; lang: Lang; facts: SetupFacts; local: Local; words: TodayWords; actions: SetupActions; step: number; goTo: (step: number, patch?: Partial<Local>) => void; onSkip: () => void; onFinish: () => void; uploader?: Uploader; prepare?: typeof preparePhoto }) {
  const id = STEPS[Math.min(Math.max(step, 0), STEPS.length - 1)];
  const [itemId] = React.useState<string>(() => crypto.randomUUID()); // the saree's id: made once, so a second press of "Add this saree" is a retry
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    headingRef.current?.focus({ preventScroll: false });
  }, [id]);
  React.useEffect(() => {
    if (id === "agent" && !local.agentSeen) goTo(step, { agentSeen: true });
  }, [id, local.agentSeen, goTo, step]);

  const numbered = step < NUMBERED;
  const titleKey = { shop: "setup.s1.title", hours: "setup.s2.title", saree: "setup.s3.title", agent: "setup.s4.title", ready: "setup.ready.title" }[id];
  const hoursDone = facts.hours?.saved === true || local.hoursDone;
  const sareeDone = (facts.sarees ?? 0) > 0 || local.sareeDone;
  const sending = facts.sending;
  const q = (s: string) => say(words, s, { shop: facts.shop });

  return (
    <section aria-labelledby="setup-h" data-setup="wizard" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {numbered ? (
          <ol aria-label={say(words, "setup.progress")} className="flex items-center gap-2">
            {STEPS.slice(0, NUMBERED).map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className={`h-2 w-8 rounded-full ${i < step ? "bg-brand" : i === step ? "bg-brand-text" : "bg-line"}`}>
                <span className="sr-only">{say(words, "setup.step", { n: i + 1, total: NUMBERED })}</span>
              </li>
            ))}
          </ol>
        ) : (
          <span />
        )}
        {id !== "ready" ? (
          <button type="button" onClick={onSkip} className={quiet}>
            {say(words, "setup.later")}
          </button>
        ) : null}
      </div>

      <div className={`${card} gap-5`}>
        <div className="flex items-center gap-4">
          <Orb px={72} state={orbStateOf(MOOD[id])} halo={MOOD[id] === "answering"} />
          <div className="min-w-0">
            {numbered ? <p className="text-sm font-semibold text-muted">{say(words, "setup.step", { n: step + 1, total: NUMBERED })}</p> : null}
            <h1 id="setup-h" ref={headingRef} tabIndex={-1} className="font-display text-[26px] font-semibold leading-[1.15] outline-none [overflow-wrap:anywhere] md:text-3xl">
              {q(titleKey)}
            </h1>
          </div>
        </div>

        {id === "shop" ? <ShopStep words={words} lang={lang} q={q} /> : null}
        {id === "hours" ? (
          <>
            <p className="text-base text-muted">{say(words, "setup.s2.text")}</p>
            <HoursStep words={words} lang={lang} settings={facts.hours?.settings ?? null} saved={hoursDone} closedDates={facts.hours?.settings.closed_dates ?? []} save={actions.saveHours} onSaved={() => goTo(step, { hoursDone: true })} />
          </>
        ) : null}
        {id === "saree" ? (
          <>
            <p className="text-base text-muted">{say(words, "setup.s3.text")}</p>
            {sareeDone && local.sareeDone ? (
              <p role="status" className="rounded-lg border border-green-text bg-green-bg px-3 py-2 text-sm font-medium text-green-text">
                {say(words, "setup.s3.added")}
              </p>
            ) : (
              <SareeStep words={words} itemId={itemId} uploadUrl={`${base}/catalogue/${itemId}/photos`} save={actions.saveItem} onAdded={() => goTo(step, { sareeDone: true })} uploader={uploader} prepare={prepare} />
            )}
          </>
        ) : null}
        {id === "agent" ? (
          <div className="flex flex-col gap-3" data-step="agent">
            <p className="text-base">{say(words, "setup.s4.does")}</p>
            <div lang="en" className="rounded-xl border border-line bg-surface-2 p-4">
              <h2 className="text-base font-semibold">{say(words, "setup.s4.waits.title")}</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
                <li>{say(words, "setup.s4.waits.money")}</li>
                <li>{say(words, "setup.s4.waits.complaints")}</li>
                <li>{say(words, "setup.s4.waits.calls")}</li>
              </ul>
            </div>
            <div lang="en" className="rounded-xl border border-line bg-surface-2 p-4" data-setup="sending">
              {sending ? (
                <>
                  <p className="text-base">{sending.auto ? say(words, "agentset.sending.on") : say(words, "setup.s4.auto")}</p>
                  <p className="mt-2 text-sm text-muted">{say(words, "setup.s4.quiet", { start: `${String(sending.quietStart).padStart(2, "0")}:00`, end: `${String(sending.quietEnd).padStart(2, "0")}:00` })}</p>
                </>
              ) : (
                <p className="text-base">{say(words, "setup.s4.auto")}</p>
              )}
            </div>
            <p>
              <Link href={`${base}/settings?section=agent`} className={secondary}>
                {say(words, "setup.s4.settings")}
              </Link>
            </p>
          </div>
        ) : null}
        {id === "ready" ? (
          <div className="flex flex-col gap-3" data-step="ready">
            <p className="text-base text-muted">{q("setup.ready.text")}</p>
            <ul className="flex flex-col gap-2">
              {[
                ["setup.ready.a1", base],
                ["setup.ready.a2", `${base}/catalogue/new`],
                ["setup.ready.a3", `${base}?tab=companies`],
              ].map(([key, href]) => (
                <li key={key}>
                  <Link href={href} onClick={onFinish} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 text-base font-semibold hover:bg-surface-2">
                    {say(words, key)}
                    <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {step > 0 && id !== "ready" ? (
            <button type="button" onClick={() => goTo(step - 1)} className={secondary}>
              {say(words, "setup.back")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {(id === "hours" && !hoursDone) || (id === "saree" && !sareeDone) ? (
              <button type="button" onClick={() => goTo(step + 1)} className={quiet}>
                {say(words, "setup.skip")}
              </button>
            ) : null}
            {id === "ready" ? (
              <Link href={base} onClick={onFinish} className={primary}>
                {say(words, "setup.ready.go")}
              </Link>
            ) : (
              <button type="button" onClick={() => goTo(step + 1)} className={primary}>
                {say(words, "setup.next")}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Step 1: the language of the app (the same cookie as the language button at the top; the page is drawn again in the chosen language). The shop's name is the one given at sign-up. */
function ShopStep({ words, lang, q }: { words: TodayWords; lang: Lang; q: (k: string) => string }) {
  const router = useRouter();
  const [current, setCurrent] = React.useState<Lang>(lang);
  const [, startTransition] = React.useTransition();
  return (
    <div className="flex flex-col gap-3" data-step="shop">
      <p className="text-base text-muted">{q("setup.s1.text")}</p>
      <fieldset>
        <legend className="mb-1.5 block text-sm font-semibold">{say(words, "setup.s1.lang")}</legend>
        <div className="flex flex-wrap gap-2">
          {LANGS.map((l) => (
            <label key={l} lang={l} className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:checked]:font-semibold has-[:checked]:text-brand-text">
              <input
                type="radio"
                name="setup-lang"
                className="sr-only"
                checked={current === l}
                onChange={() => {
                  const next = readLang(l);
                  setCurrent(next);
                  document.cookie = serializePreference(LANG_COOKIE, next, window.location.protocol === "https:");
                  startTransition(() => router.refresh());
                }}
              />
              {LANGUAGE_NAMES[l].native}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-muted">{say(words, "setup.s1.lang.help")}</p>
      </fieldset>
    </div>
  );
}
