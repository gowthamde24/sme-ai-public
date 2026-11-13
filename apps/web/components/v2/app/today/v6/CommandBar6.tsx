"use client";

import * as React from "react";

import { Orb, type OrbState } from "@/components/v2/Orb";
import { isVoiceLang } from "@/lib/browser-voice/protocol";

import { VoiceMic } from "../../voice-input/LazyVoiceMic";
import { btnMain } from "../../ui";
import { makeT, type Words } from "../../words";
import { AskAnswer } from "../ask/AskView";
import { AskProvidedContext } from "../ask/ask-store";
import { CHAT_LANGS, useChatLanguage } from "../ask/chat-language";
import { LanguagePill } from "../ask/LanguagePill";
import { CommandBar } from "../CommandBar";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { CHIPS, PLACEHOLDER_KEYS } from "./band-data";
import { LazyLiveBar } from "./LazyLiveBar";
import { usePlanSubmit } from "./use-plan-submit";
import { setTalking, useIsDesktop, useTalking } from "./v6-state";

/** How long an example stays as the placeholder (ms). */
const CYCLE_MS = 4500;

const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The "Talk live" badge on the orb: a small pill with a play mark and the words. */
export function TalkBadge({ label }: { label: string }) {
  return (
    <span data-part="talk-badge" className="mt-1 inline-flex items-center gap-1 rounded-full bg-brand-bg px-2 py-0.5 text-xs font-bold text-brand-text">
      <span aria-hidden="true">▶</span>
      {label}
    </span>
  );
}

/**
 * Today's command bar, design system v6 (owner, 13 Nov 2026): the glowing bar in two rows. Row 1: the assistant's real circle with its "Talk live" badge, the label TELL YOUR ASSISTANT WHAT TO DO and a large (24 px) input whose placeholder cycles through real examples.
 * Row 2: four chips that prefill the input, a compact language dropdown, a small microphone that dictates into the input, and the primary "Do it". "Do it" (or Enter) goes into the EXISTING plan-card flow of the shared conversation: the plan appears under the bar
 * (what, about how long, about how much, calling hours), the owner approves it, it runs, and it can be undone: nothing here starts anything by itself. Tapping the circle turns the SAME bar into the live voice conversation in place (no popup): End returns to
 * the bar, Type returns to the input. Where the assistant is not on (or not there), the card's own states are drawn instead (the old bar).
 */
export function CommandBar6({ lang, base, availability, words, askWords, chips, job = null }: { /** A suggested job to hand to the plan flow: a new `n` is a new press. */ job?: { n: number; text: string } | null; lang: string; base: string; availability: Availability; /** The v6 words (`tv6.`) and the talk words (`dst.`). */ words: Words; /** The conversation's own words (`ask.`), for the fallback bar. */ askWords: AskWords; chips: readonly string[] }) {
  const t = makeT(words);
  const provided = React.useContext(AskProvidedContext);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [ph, setPh] = React.useState(0);
  const chat = useChatLanguage(isVoiceLang(lang) ? lang : "en", null, undefined, base.split("/").pop() ?? null);
  const native = CHAT_LANGS.find((l) => l.code === (chat.pill === "auto" ? chat.reply : chat.pill))?.native ?? "English";
  const reply = chat.pill === "auto" ? undefined : chat.reply;
  const { session, submit } = usePlanSubmit(reply, () => setText(""));

  // the examples cycle while the person is not typing; with reduced motion the first one stays
  React.useEffect(() => {
    if (focused || text !== "" || talking || reducedMotion()) return;
    const id = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDER_KEYS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [focused, text, talking]);

  // a suggested job (the row under the bar) is an instruction that goes in at once
  const lastJob = React.useRef(0);
  React.useEffect(() => {
    if (!job || job.n === lastJob.current) return;
    lastJob.current = job.n;
    setText(job.text);
    submit(job.text);
  }, [job, submit]);
  if (availability !== "live") return <CommandBar lang={lang} base={base} availability={availability} words={askWords} chips={chips} />;

  const send = () => {
    submit(text);
  };
  const ready = provided && session !== null && session.live;
  const orbState: OrbState = session?.phase === "asking" ? "think" : focused || text !== "" ? "listen" : "ambient";

  return (
    <section id="ask" data-part="command-bar" data-v6="" aria-label={t("tv6.cmd.label")} className="ds-glow scroll-mt-24 rounded-2xl p-4 md:p-5 max-md:hidden">
      {talking && desktop ? (
        <LazyLiveBar words={words} language={native} onClose={(via) => { setTalking(false); if (via === "type") queueMicrotask(() => inputRef.current?.focus()); }} />
      ) : (
        <form
          data-write
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="flex items-center gap-4">
            <button type="button" data-part="band-orb" onClick={() => setTalking(true)} aria-label={t("dst.talk_live")} className="flex shrink-0 flex-col items-center rounded-2xl p-1 hover:bg-surface-2 focus-visible:outline-2">
              <Orb px={64} state={orbState} />
              <TalkBadge label={t("dst.talk_live")} />
            </button>
            <div className="min-w-0 flex-1">
              <label htmlFor="ask-input" className="block text-xs font-bold tracking-wider text-muted">
                {t("tv6.cmd.label")}
              </label>
              <input
                ref={inputRef}
                id="ask-input"
                type="text"
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={t(PLACEHOLDER_KEYS[ph])}
                autoComplete="off"
                disabled={!ready && provided}
                className="mt-1 min-h-14 w-full min-w-0 rounded-xl border border-edge bg-bg px-4 text-2xl text-ink placeholder:text-muted focus:border-brand-edge"
              />
            </div>
          </div>
          <div data-part="band-row2" className="flex flex-wrap items-center gap-2">
            <ul className="flex min-w-0 flex-wrap gap-2" aria-label={t("tv6.chips.label")}>
              {CHIPS.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-chip={c.id}
                    onClick={() => {
                      setText(t(c.fill));
                      inputRef.current?.focus();
                    }}
                    className="inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2"
                  >
                    {t(c.label)}
                  </button>
                </li>
              ))}
            </ul>
            <span className="ml-auto flex items-center gap-2">
              <LanguagePill value={chat.pill} onChange={chat.set} label={t("tv6.lang.label")} auto={t("tv6.lang.auto")} />
              <VoiceMic target={inputRef} size="icon" />
              <button type="submit" disabled={text.trim() === "" || !ready} className={`${btnMain} min-h-11 px-5`}>
                {t("tv6.do_it")}
              </button>
            </span>
          </div>
        </form>
      )}
      {session ? (
        <div className="empty:hidden">
          <AskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} />
        </div>
      ) : null}
    </section>
  );
}
