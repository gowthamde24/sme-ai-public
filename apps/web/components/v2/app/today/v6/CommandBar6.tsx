"use client";

import { FileText, Globe, MessageCircle, Paperclip, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { isVoiceLang } from "@/lib/browser-voice/protocol";

import { VoiceMic } from "../../voice-input/LazyVoiceMic";
import { makeT, type Words } from "../../words";
import { AskAnswer } from "../ask/AskView";
import { AskProvidedContext } from "../ask/ask-store";
import { CHAT_LANGS, useChatLanguage, type ChatLang } from "../ask/chat-language";
import { CommandBar } from "../CommandBar";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { CHIPS, PLACEHOLDER_KEYS, ghostOf } from "./band-data";
import { LazyLiveBar } from "./LazyLiveBar";
import { usePlanSubmit } from "./use-plan-submit";
import { setTalking, useIsDesktop, useTalking } from "./v6-state";

/** How long an example stays as the ghost text (ms). */
const CYCLE_MS = 4500;

const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const CHIP_ICON = { call: Phone, whatsapp: MessageCircle, quote: FileText } as const;

/** The language dropdown of the composer: a globe, the business language in its own script and a small arrow; a real select laid over it (the right control on a phone, and the keyboard works as everywhere). */
function LangDrop({ value, onChange, label, auto }: { value: ChatLang; onChange: (l: ChatLang) => void; label: string; auto: string }) {
  const shown = CHAT_LANGS.find((l) => l.code === value)?.native ?? auto;
  return (
    <label data-chat="language" className="ds-glass relative cursor-pointer focus-within:border-brand-edge">
      <Globe className="size-4 text-muted" aria-hidden="true" />
      <span aria-hidden="true" lang={value === "auto" ? undefined : value}>
        {shown}
      </span>
      <em aria-hidden="true" className="text-[10px] not-italic text-muted">
        ▾
      </em>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ChatLang)} className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent text-base opacity-0">
        {CHAT_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native ?? auto}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Today's composer, design system v6, the final design (owner, 13 Nov 2026): a glowing conic edge around a glass box, inside the dark band. One line of 22px text with a GHOST COMPLETION (the rest of an example: Tab accepts it, Enter is "Do it", Cmd or Ctrl+K focuses it from anywhere on Today),
 * the attach icon inside the field on the right, then row 2: three chips (Call people, WhatsApp, Quote) that prefill the input, the language dropdown (starts on the business language), the dictation mic and "Do it ↵", the only solid orange in the band. "Do it" and Enter go into the EXISTING plan-card flow of the
 * shared conversation: the plan appears under the box (what, how long, how much, calling hours), the owner approves it, it runs, it can be undone: nothing starts by itself. Tapping the orb (in the band) turns this SAME box into the live voice conversation in place; End returns, Type returns to the input.
 * Where the assistant is not on (or not there), the card's own old states are drawn instead.
 */
export function CommandBar6({ lang, base, availability, words, askWords, chips, businessLang = null }: { /** The business's own language (its profile): the language dropdown starts on it, never on Auto. */ businessLang?: string | null; lang: string; base: string; availability: Availability; /** The v6 words (`tv6.`) and the talk words (`dst.`). */ words: Words; /** The conversation's own words (`ask.`), for the fallback bar. */ askWords: AskWords; chips: readonly string[] }) {
  const t = makeT(words);
  const provided = React.useContext(AskProvidedContext);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [ph, setPh] = React.useState(0);
  const chat = useChatLanguage(isVoiceLang(lang) ? lang : "en", businessLang ?? (isVoiceLang(lang) ? lang : null), undefined, base.split("/").pop() ?? null);
  const native = CHAT_LANGS.find((l) => l.code === (chat.pill === "auto" ? chat.reply : chat.pill))?.native ?? "English";
  const reply = chat.pill === "auto" ? undefined : chat.reply;
  const { session, submit } = usePlanSubmit(reply, () => setText(""));
  const examples = PLACEHOLDER_KEYS.map((k) => t(k));
  // the ghost: the rest of an example that starts with what is typed; with nothing typed, the cycling example in full
  const ghost = text === "" ? examples[ph] : ghostOf(text, examples);

  // the examples cycle while the person is not typing; with reduced motion the first one stays
  React.useEffect(() => {
    if (focused || text !== "" || talking || reducedMotion()) return;
    const id = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDER_KEYS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [focused, text, talking]);

  // Cmd or Ctrl + K focuses the composer from anywhere on Today (the final design's shortcut); on a phone the composer is not there
  const desktopRef = React.useRef(desktop);
  React.useEffect(() => {
    desktopRef.current = desktop;
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      const el = inputRef.current;
      if (!el || !desktopRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      el.focus();
      el.select();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (availability !== "live") return <CommandBar lang={lang} base={base} availability={availability} words={askWords} chips={chips} />;

  // "Do it" is always there in full orange; with nothing written it takes the person to the input
  const send = () => {
    if (text.trim() === "") inputRef.current?.focus();
    else submit(text);
  };
  const ready = provided && session !== null && session.live;
  const inTalk = talking && desktop;

  return (
    <section id="ask" data-part="command-bar" data-v6="" aria-label={t("tv6.cmd.label")} className="ds-comp scroll-mt-24 max-md:hidden">
      <div className={inTalk ? "ds-compin !p-0" : "ds-compin"}>
        {inTalk ? (
          <LazyLiveBar
            variant="bar"
            words={words}
            language={native}
            onClose={(via) => {
              setTalking(false);
              if (via === "type") queueMicrotask(() => inputRef.current?.focus());
            }}
          />
        ) : (
          <form
            data-write
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="relative pr-11">
              <label htmlFor="ask-input" className="sr-only">
                {t("tv6.cmd.label")}
              </label>
              {/* the ghost sits under the typed text: the same text made invisible, then the rest in grey */}
              <div aria-hidden="true" data-part="ghost" className="ds-ln pointer-events-none absolute inset-0 overflow-hidden whitespace-pre">
                <span className="invisible">{text}</span>
                <span className="ds-ghost">{ghost}</span>
              </div>
              <input
                ref={inputRef}
                id="ask-input"
                type="text"
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey && ghost) {
                    e.preventDefault();
                    setText(text === "" ? ghost : `${text}${ghost}`);
                  } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={!ready && provided}
                className="ds-ln relative block w-full min-w-0 border-0 bg-transparent p-0 font-medium text-ink caret-brand outline-none focus:outline-none focus-visible:outline-none"
              />
              <Link href={`${base}/catalogue`} data-part="attach" aria-label={t("tv6.attach")} title={t("tv6.attach")} className="absolute right-0 top-0 grid size-9 place-items-center rounded-[10px] text-muted hover:text-ink">
                <Paperclip className="size-[18px]" aria-hidden="true" />
              </Link>
            </div>
            <div data-part="band-row2" className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              <ul className="flex min-w-0 gap-1.5 overflow-hidden" aria-label={t("tv6.chips.label")}>
                {CHIPS.map((c) => {
                  const Icon = CHIP_ICON[c.id];
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        data-chip={c.id}
                        onClick={() => {
                          setText(`${t(c.fill)} `);
                          inputRef.current?.focus();
                        }}
                        className="ds-chip hover:bg-surface-2"
                      >
                        <Icon className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
                        {t(c.label)}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex shrink-0 items-center gap-1.5">
                <LangDrop value={chat.pill} onChange={chat.set} label={t("tv6.lang.label")} auto={t("tv6.lang.auto")} />
                <VoiceMic target={inputRef} size="icon" />
                <button type="submit" className="ds-do shrink-0">
                  {t("tv6.do_it")}
                  <kbd aria-hidden="true">↵</kbd>
                </button>
              </div>
            </div>
            <p className="sr-only">{t("tv6.keys")}</p>
          </form>
        )}
        {session ? (
          <div className={inTalk ? "px-[22px] pb-4 empty:hidden" : "empty:hidden"}>
            <AskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
