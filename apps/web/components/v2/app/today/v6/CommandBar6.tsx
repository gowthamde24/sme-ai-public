"use client";

import { FileText, MessageCircle, Phone, Search } from "lucide-react";
import * as React from "react";

import type { OrbState } from "@/components/v2/Orb";
import { isVoiceLang } from "@/lib/browser-voice/protocol";

import { VoiceMic } from "../../voice-input/LazyVoiceMic";
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
import { OrbRing } from "./OrbRing";
import { usePlanSubmit } from "./use-plan-submit";
import { setTalking, useIsDesktop, useTalking } from "./v6-state";

/** How long an example stays as the placeholder (ms). */
const CYCLE_MS = 4500;

const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The "Talk live" badge on the orb: a small dark pill with a play mark and the words, over the bottom of the circle. */
export function TalkBadge({ label }: { label: string }) {
  return (
    <span data-part="talk-badge" className="-mt-2.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-charcoal px-2.5 py-1 text-[11.5px] font-extrabold text-on-charcoal shadow-[0_0_0_3px_var(--ds-glow)]">
      <span aria-hidden="true">▶</span>
      {label}
    </span>
  );
}

const CHIP_ICON = { call: Phone, whatsapp: MessageCircle, quote: FileText, find: Search } as const;
function ChipIcon({ id }: { id: keyof typeof CHIP_ICON }) {
  const I = CHIP_ICON[id];
  return <I className="size-3.5 shrink-0 text-muted" aria-hidden="true" />;
}

/**
 * Today's command bar, design system v6 (owner, 13 Nov 2026): the glowing bar in two rows. Row 1: the assistant's real circle with its "Talk live" badge, the label TELL YOUR ASSISTANT WHAT TO DO and a large (24 px) input whose placeholder cycles through real examples.
 * Row 2: four chips that prefill the input, a compact language dropdown, a small microphone that dictates into the input, and the primary "Do it". "Do it" (or Enter) goes into the EXISTING plan-card flow of the shared conversation: the plan appears under the bar
 * (what, about how long, about how much, calling hours), the owner approves it, it runs, and it can be undone: nothing here starts anything by itself. Tapping the circle turns the SAME bar into the live voice conversation in place (no popup): End returns to
 * the bar, Type returns to the input. Where the assistant is not on (or not there), the card's own states are drawn instead (the old bar).
 */
export function CommandBar6({ lang, base, availability, words, askWords, chips, job = null, businessLang = null }: { /** The business's own language (its profile): the language dropdown starts on it, never on Auto. */ businessLang?: string | null; /** A suggested job to hand to the plan flow: a new `n` is a new press. */ job?: { n: number; text: string } | null; lang: string; base: string; availability: Availability; /** The v6 words (`tv6.`) and the talk words (`dst.`). */ words: Words; /** The conversation's own words (`ask.`), for the fallback bar. */ askWords: AskWords; chips: readonly string[] }) {
  const t = makeT(words);
  const provided = React.useContext(AskProvidedContext);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [ph, setPh] = React.useState(0);
  const chat = useChatLanguage(isVoiceLang(lang) ? lang : "en", businessLang ?? (isVoiceLang(lang) ? lang : null), undefined, base.split("/").pop() ?? null);
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

  // "Do it" is always there in full orange; with nothing written it takes the person to the input
  const send = () => {
    if (text.trim() === "") inputRef.current?.focus();
    else submit(text);
  };
  const ready = provided && session !== null && session.live;
  const orbState: OrbState = session?.phase === "asking" ? "think" : focused || text !== "" ? "listen" : "ambient";

  return (
    <section id="ask" data-part="command-bar" data-v6="" aria-label={t("tv6.cmd.label")} className="ds-cmdw scroll-mt-24 max-md:hidden">
      <div className="ds-cmd">
        {talking && desktop ? (
          <LazyLiveBar variant="bar" words={words} language={native} onClose={(via) => { setTalking(false); if (via === "type") queueMicrotask(() => inputRef.current?.focus()); }} />
        ) : (
          <form
            data-write
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex items-start gap-4 pb-2.5 pl-3.5 pr-5 pt-5">
              <button type="button" data-part="band-orb" onClick={() => setTalking(true)} aria-label={t("dst.talk_live")} className="flex shrink-0 flex-col items-center rounded-2xl focus-visible:outline-2">
                <OrbRing state={orbState} />
                <TalkBadge label={t("dst.talk_live")} />
              </button>
              <div className="min-w-0 flex-1">
                <label htmlFor="ask-input" className="block text-[11.5px] font-bold uppercase tracking-[0.1em] text-brand-text">
                  {t("tv6.cmd.label")}
                </label>
                <textarea
                  ref={inputRef}
                  id="ask-input"
                  rows={2}
                  value={text}
                  maxLength={500}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={t(PLACEHOLDER_KEYS[ph])}
                  autoComplete="off"
                  disabled={!ready && provided}
                  className="mt-1.5 block w-full min-w-0 resize-none border-0 bg-transparent p-0 text-2xl font-medium leading-[1.35] tracking-[-0.3px] text-ink outline-none placeholder:text-muted focus:outline-none focus-visible:outline-none"
                />
              </div>
            </div>
            <div data-part="band-row2" className="flex items-center gap-2.5 border-t border-line py-3 pl-5 pr-3.5">
              <ul className="flex min-w-0 flex-1 flex-wrap gap-[7px]" aria-label={t("tv6.chips.label")}>
                {CHIPS.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-chip={c.id}
                      onClick={() => {
                        setText(`${t(c.fill)} `);
                        inputRef.current?.focus();
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 text-[13px] text-ink hover:bg-surface"
                    >
                      <ChipIcon id={c.id} />
                      {t(c.label)}
                    </button>
                  </li>
                ))}
              </ul>
              <LanguagePill value={chat.pill} onChange={chat.set} label={t("tv6.lang.label")} auto={t("tv6.lang.auto")} />
              <VoiceMic target={inputRef} size="icon" />
              <button type="submit" className="ds-do shrink-0">
                {t("tv6.do_it")}
              </button>
            </div>
          </form>
        )}
        {session ? (
          <div className="px-5 pb-4 empty:hidden">
            <AskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
