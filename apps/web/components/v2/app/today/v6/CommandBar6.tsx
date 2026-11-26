"use client";

import { FileText, Globe, MessageCircle, Paperclip, Phone } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";

import { isVoiceLang } from "@/lib/browser-voice/langs";

import { VoiceMic } from "../../voice-input/LazyVoiceMic";
import { makeT, type Words } from "../../words";
import { LazyAskAnswer } from "../ask/LazyAskAnswer";
import { AskProvidedContext, AskVoiceContext } from "../ask/ask-store";
import { useAskAwake, wakeAsk } from "../ask/ask-wake";
import { useChatWork } from "../ask/work/use-chat-work";
import { CHAT_LANGS, useChatLanguage, type ChatLang } from "../ask/chat-language";
import { CommandBar } from "../CommandBar";
import type { Availability } from "../ask/ask-types";
import type { AskWords } from "../ask/ask-words";
import { CHIPS, PLACEHOLDER_KEYS, ghostOf } from "./band-data";
import { LazyLiveBar } from "./LazyLiveBar";
import { LightNote, useLightUntil } from "./LightNote";

/** The conversation under the bar, as a chat thread (one lazy chunk: Today's first load does not carry the chat). */
const ChatThread = dynamic(() => import("../ask/ChatCardHost"), { ssr: false });
import { sendsOnEnter } from "../composer-keys";
import { useRestoreThread } from "../ask/use-restore-thread";
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
  const lightUntil = useLightUntil();
  const provided = React.useContext(AskProvidedContext);
  const talking = useTalking();
  const desktop = useIsDesktop();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [ph, setPh] = React.useState(0);
  const chat = useChatLanguage(isVoiceLang(lang) ? lang : "en", null, undefined, base.split("/").pop() ?? null);
  const native = CHAT_LANGS.find((l) => l.code === (chat.pill === "auto" ? chat.reply : chat.pill))?.native ?? "English";
  const reply = chat.pill === "auto" ? undefined : chat.reply;
  const { session, submit } = usePlanSubmit(reply, () => setText(""));
  const awake = useAskAwake();
  useRestoreThread(session, awake); // the earlier conversation is read at the first use of the composer or the orb (or 4 s after load, when idle), not at load (ask-wake.ts)
  // files beside the instruction (paperclip, drag-and-drop, a pasted screenshot): uploaded at once, sent with the words; the cards come back in the conversation
  const voice = React.useContext(AskVoiceContext);
  const work = useChatWork(voice?.work, base, voice?.words ?? words, setText);
  const examples = PLACEHOLDER_KEYS.map((k) => t(k));
  // the ghost: the rest of an example that starts with what is typed; with nothing typed, the cycling example in full
  const ghost = text === "" ? examples[ph] : ghostOf(text, examples);

  // the examples cycle while the person is not typing; with reduced motion the first one stays
  React.useEffect(() => {
    if (focused || text !== "" || talking || reducedMotion()) return;
    const id = setInterval(() => setPh((i) => (i + 1) % PLACEHOLDER_KEYS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [focused, text, talking]);

  // the field grows with what is typed, up to about six lines, then it scrolls inside (owner, 14 Nov)
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

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

  // a file attached during Talk live goes in at once, as a typed message in the same conversation (the call goes on)
  const talkAttach = talking && desktop && work.hasReady && !work.uploading;
  const takeFiles = work.take;
  const sendIt = submit;
  React.useEffect(() => {
    if (!talkAttach) return;
    const sent = takeFiles("");
    sendIt(sent.text, sent.ids, sent.local);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkAttach]);

  if (availability !== "live") return <CommandBar lang={lang} base={base} availability={availability} words={askWords} chips={chips} />;

  // "Do it" is always there in full orange; with nothing written it takes the person to the input
  const send = () => {
    if (work.uploading) return;
    if (text.trim() === "" && !work.hasReady) inputRef.current?.focus();
    else {
      const sent = work.take(text);
      submit(sent.text, sent.ids, sent.local);
    }
  };
  const ready = provided && session !== null && session.live;
  const inTalk = talking && desktop;

  // the thread (a chunk of its own, with the voice sign-in it asks for) is drawn from the first use on; before that it would only be empty, and a conversation that has something in it is drawn at once
  const thread = session && (awake || session.phase !== "idle" || session.earlier.length > 0) ? (
    <div className={inTalk ? "px-[22px] pb-4 empty:hidden" : "mb-3 empty:hidden"}>
      {voice && session.mode !== "do" ? <ChatThread variant="thread" session={session} chips={[]} voice={voice} /> : <LazyAskAnswer session={session} chips={[]} earlierWord={session.w("ask.earlier")} conversational />}
    </div>
  ) : null;

  return (
    <section id="ask" data-part="command-bar" data-v6="" aria-label={t("tv6.cmd.label")} onPointerDownCapture={wakeAsk} onFocusCapture={wakeAsk} onKeyDownCapture={wakeAsk} className="ds-comp scroll-mt-24 max-md:hidden">
      <div className={inTalk ? "ds-compin !p-0" : "ds-compin"}>
        {/* the messages above, the field at the bottom (owner, 14 Nov: like Talk live and WhatsApp); in Talk live the typed thread stays under the call */}
        {!inTalk ? thread : null}
        {inTalk ? (
          <LazyLiveBar
            variant="bar"
            words={words}
            onAttach={work.on ? work.pick : undefined}
            voiceHref={`${base}/ai-team/training?section=voice&for=you`}
            appLang={lang}
            language={native}
            voiceLanguage={chat.reply}
            stt={chat.stt}
            onClose={(via) => {
              setTalking(false);
              if (via === "type") queueMicrotask(() => inputRef.current?.focus());
            }}
          />
        ) : (
          <form
            data-write
            {...work.dropProps}
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
              <div aria-hidden="true" data-part="ghost" className="ds-ln pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap [overflow-wrap:anywhere]">
                <span className="invisible">{text}</span>
                <span className="ds-ghost">{ghost}</span>
              </div>
              <textarea
                ref={inputRef}
                id="ask-input"
                rows={1}
                value={text}
                maxLength={2000}
                onChange={(e) => setText(e.target.value)}
                onPaste={work.onPaste}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey && ghost) {
                    e.preventDefault();
                    setText(text === "" ? ghost : `${text}${ghost}`);
                  } else if (sendsOnEnter(e)) {
                    // Enter sends, Shift+Enter is a new line (on a touch screen Enter is a new line and "Do it" sends)
                    e.preventDefault();
                    send();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                disabled={!ready && provided}
                className="ds-ln relative block max-h-[11rem] w-full min-w-0 resize-none overflow-y-auto border-0 bg-transparent p-0 font-medium text-ink caret-brand outline-none focus:outline-none focus-visible:outline-none"
              />
              {work.on ? (
                <button type="button" data-part="attach" onClick={work.pick} aria-label={t("tv6.attach")} title={t("tv6.attach")} className="absolute right-0 top-0 grid size-9 place-items-center rounded-[10px] text-muted hover:text-ink">
                  <Paperclip className="size-[18px]" aria-hidden="true" />
                </button>
              ) : (
                              <Link href={`${base}/catalogue`} data-part="attach" aria-label={t("tv6.attach")} title={t("tv6.attach")} className="absolute right-0 top-0 grid size-9 place-items-center rounded-[10px] text-muted hover:text-ink">
                  <Paperclip className="size-[18px]" aria-hidden="true" />
                </Link>
              )}
            </div>
            {work.chips ? <div className="mt-3">{work.chips}</div> : null}
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
            <LightNote words={words} until={lightUntil} className="mx-[22px] mb-3" />
          </form>
        )}
        {/* the file pickers live outside the form: in Talk live the form is not drawn, and a file still goes in as a typed message while the call goes on */}
        {work.input}
        {work.cameraInput}
        {inTalk && work.chips ? <div className="px-[22px] pb-3">{work.chips}</div> : null}
        {inTalk ? thread : null}
      </div>
    </section>
  );
}
