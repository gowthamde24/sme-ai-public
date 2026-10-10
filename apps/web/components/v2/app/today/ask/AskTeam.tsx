"use client";

import { ArrowRight, Mic, MicOff, Send, Square } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ERROR_CODES, type AskDraft, type AskSource, type AskTransport, type Availability } from "./ask-types";
import type { AskWords } from "./ask-words";
import { makeAskTransport } from "./transport";
import { MainAvatar } from "./MainAvatar";
import { recognitionCtor, speechLang, speechProblem, transcriptOf, type Recognition } from "./speech";

const MAX_QUESTION = 500;
const MAX_ANSWER = 8000;
const MAX_SOURCES = 8;
const MAX_DRAFTS = 5;
const card = "rounded-xl border border-line bg-surface shadow-[var(--v2-shadow)]";
const chip = "inline-flex min-h-11 items-center rounded-full border border-edge bg-surface px-4 text-base text-ink hover:bg-surface-2 disabled:opacity-50";

/** A link the answer asks for, kept only when it stays inside this workspace: the answer can quote a customer's e-mail, so nothing it contains is followed blindly. */
export function insideWorkspace(href: string, base: string): string | null {
  if (typeof href !== "string" || href.length > 300 || !href.startsWith(base) || /[\\\u0000-\u001f]/.test(href)) return null;
  try {
    const u = new URL(href, "http://workspace.invalid");
    const inside = u.pathname === base || u.pathname.startsWith(`${base}/`);
    if (u.origin !== "http://workspace.invalid" || !inside || u.pathname.includes("//") || u.pathname.split("/").includes("..")) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

const KIND_WORD: Readonly<Record<string, string>> = { quote: "today.kind.quote", followup_draft: "today.kind.followup", reply_draft: "ask.kind.reply", enquiry: "ask.kind.enquiry" };

type Phase = "idle" | "asking" | "done" | "error";
type Problem = "denied" | "silent" | "failed" | null;

/**
 * "Ask your team": a question to the Main agent, answered from the workspace's own records. The answer streams in as plain text, with the screens it came from as links; anything the agent
 * prepared is shown as a DRAFT card whose "Approve" opens the screen that decides (nothing is approved, sent or recorded from here). The microphone (the browser's speech recognition, in the
 * language of the language chip) fills the box with what it heard; the person reads it and presses Ask. It is hidden when the browser has no speech recognition.
 * While there is no Main agent to ask (it is not built, its switch is off, or the answer stream does not exist yet) the box says so and offers nothing to press.
 */
export function AskTeam({ lang, base, words, availability, transport: given }: { lang: string; base: string; words: AskWords; availability: Availability; transport?: AskTransport | null }) {
  const w = (key: string) => words[key] ?? key;
  const own = React.useMemo(() => (availability === "live" && given === undefined ? makeAskTransport(`${base}/ask`) : null), [availability, given, base]);
  const transport = given === undefined ? own : given;
  const [text, setText] = React.useState("");
  const [asked, setAsked] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [answer, setAnswer] = React.useState("");
  const [sources, setSources] = React.useState<AskSource[]>([]);
  const [drafts, setDrafts] = React.useState<AskDraft[]>([]);
  const [listening, setListening] = React.useState(false);
  const [problem, setProblem] = React.useState<Problem>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const rec = React.useRef<Recognition | null>(null);
  const canSpeak = React.useSyncExternalStore(
    () => () => {},
    () => recognitionCtor() !== null,
    () => false,
  );

  React.useEffect(
    () => () => {
      abort.current?.abort();
      rec.current?.abort();
    },
    [],
  );

  const live = availability === "live" && transport !== null;
  const title = (
    <div className="flex items-center gap-3">
      <MainAvatar />
      <div className="min-w-0">
        <h2 id="ask-heading" className="font-display text-xl font-semibold leading-tight">
          {w("ask.title")}
        </h2>
        <p className="text-sm text-muted">{live ? w("ask.sub") : availability === "switched_off" ? w("office.switchedoff") : w("frame.notyet")}</p>
      </div>
    </div>
  );
  if (!live || transport === null) {
    return (
      <section aria-labelledby="ask-heading" data-ask="unavailable" className={`${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5`}>
        {title}
      </section>
    );
  }

  const ask = async (raw: string) => {
    const question = raw.trim().slice(0, MAX_QUESTION);
    if (!question) return;
    abort.current?.abort();
    rec.current?.abort(); // asking ends listening: a late word must not overwrite the box
    setListening(false);
    const controller = new AbortController();
    abort.current = controller;
    setAsked(question);
    setText("");
    setProblem(null);
    setPhase("asking");
    setErrorCode(null);
    setAnswer("");
    setSources([]);
    setDrafts([]);
    let failed = false;
    try {
      for await (const e of transport({ question, lang, signal: controller.signal })) {
        if (controller.signal.aborted) return;
        if (e.type === "text" && typeof e.delta === "string") setAnswer((a) => (a + e.delta).slice(0, MAX_ANSWER));
        else if (e.type === "source") {
          const href = e.href === null ? null : insideWorkspace(e.href, base);
          if (typeof e.label === "string" && (href !== null || e.href === null)) {
            const label = e.label.slice(0, 80);
            setSources((s) => (s.length >= MAX_SOURCES || s.some((x) => x.href === href && x.label === label) ? s : [...s, { label, href }]));
          }
        } else if (e.type === "draft") {
          const href = e.href === null ? null : insideWorkspace(e.href, base);
          if (href !== null || e.href === null)
            setDrafts((d) =>
              d.length >= MAX_DRAFTS || d.some((x) => x.id === e.id)
                ? d
                : [...d, { id: String(e.id).slice(0, 64), kind: String(e.kind), title: String(e.title).slice(0, 120), summary: String(e.summary).slice(0, 400), href, language: typeof e.language === "string" ? e.language.slice(0, 8) : null, gloss: typeof e.gloss === "string" ? e.gloss.slice(0, 400) : null, machine: e.machine === true }],
            );
        } else if (e.type === "error") {
          failed = true;
          setErrorCode(typeof e.code === "string" && (ERROR_CODES as readonly string[]).includes(e.code) ? e.code : null);
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      failed = true;
    }
    if (!controller.signal.aborted) setPhase(failed ? "error" : "done");
  };

  const stop = () => {
    abort.current?.abort();
    setPhase(answer || drafts.length || sources.length ? "done" : "idle");
  };

  const listen = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = speechLang(lang);
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => setText(transcriptOf(e.results).slice(0, MAX_QUESTION));
    r.onerror = (e) => setProblem(speechProblem(e.error));
    r.onend = () => setListening(false);
    rec.current = r;
    setProblem(null);
    try {
      r.start();
      setListening(true);
    } catch {
      setProblem("failed");
    }
  };

  const chips = [w("ask.chip.needs"), w("ask.chip.quotes"), w("ask.chip.money"), w("ask.chip.team")];
  const asking = phase === "asking";
  return (
    <section aria-labelledby="ask-heading" data-ask="live" className={`${card} mx-auto mb-8 max-w-3xl p-4 sm:p-5`}>
      {title}
      <form
        className="mt-4 flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          {w("ask.label")}
        </label>
        <input
          id="ask-input"
          value={text}
          maxLength={MAX_QUESTION}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? w("ask.listening") : w("ask.placeholder")}
          autoComplete="off"
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 text-base text-ink placeholder:text-muted focus:border-brand-edge"
        />
        {canSpeak ? (
          <button type="button" onClick={listen} aria-pressed={listening} aria-label={listening ? w("ask.mic.stop") : w("ask.mic")} title={listening ? w("ask.mic.stop") : w("ask.mic")} className={`inline-flex size-12 shrink-0 items-center justify-center rounded-lg border ${listening ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
            {listening ? <MicOff className="size-5" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>
        ) : null}
        {asking ? (
          <button type="button" onClick={stop} className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-edge bg-surface px-3 text-base font-semibold text-ink hover:bg-surface-2 sm:px-4">
            <Square className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{w("ask.stop")}</span>
          </button>
        ) : (
          <button type="submit" disabled={text.trim() === ""} className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-edge bg-brand px-3 text-base font-semibold text-on-brand hover:brightness-95 disabled:opacity-50 sm:px-4">
            <Send className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{w("ask.send")}</span>
          </button>
        )}
      </form>
      {listening ? <p className="mt-2 text-sm text-muted">{w("ask.mic.privacy")}</p> : null}
      {problem ? (
        <p role="status" className="mt-2 text-sm text-amber-text">
          {w(`ask.mic.${problem}`)}
        </p>
      ) : null}
      {phase === "idle" ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={w("ask.title")}>
          {chips.map((c) => (
            <li key={c}>
              <button type="button" onClick={() => void ask(c)} className={chip}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {phase !== "idle" ? (
        <div className="mt-4 border-t border-line pt-4" aria-live="polite" aria-busy={asking}>
          <p className="text-sm text-muted">{`${w("ask.asked")} ${asked}`}</p>
          {answer ? <p className="mt-2 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{answer}</p> : asking ? <p className="mt-2 text-base text-muted">{w("ask.thinking")}</p> : null}
          {phase === "error" ? (
            <p role="alert" className="mt-2 text-base font-medium text-red-text">
              {errorCode === "cost_cap_reached" ? w("ask.err.cost") : errorCode === "run_limit_reached" ? w("ask.err.limit") : errorCode === "forbidden" ? w("ask.err.role") : errorCode === "agents_disabled" ? w("office.switchedoff") : w("ask.error")}
            </p>
          ) : null}
          {sources.length ? (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">{w("ask.sources")}</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {sources.map((s, i) => (
                  <li key={`${s.href ?? "-"}-${i}`}>
                    {s.href ? (
                      <Link href={s.href} prefetch={false} className="inline-flex min-h-11 items-center rounded-lg border border-edge bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2">
                        {s.label}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface-2 px-3 text-sm font-medium text-muted">{s.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {drafts.length ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{w("ask.drafts")}</h3>
              <ul className="mt-2 space-y-3">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <article aria-label={d.title} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md border border-edge bg-surface px-2 py-0.5 text-sm font-semibold">{w("today.state.draft")}</span>
                        <span className="text-sm font-medium text-muted">{KIND_WORD[d.kind] ? w(KIND_WORD[d.kind]) : ""}</span>
                        {d.machine ? <span className="text-sm font-medium text-muted">{w("ask.machine")}</span> : null}
                      </div>
                      <h4 className="mt-2 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{d.title}</h4>
                      <p lang={d.language ?? undefined} className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">{d.summary}</p>
                      {d.gloss ? (
                        <p className="mt-2 border-l-2 border-edge pl-3 text-base text-muted [overflow-wrap:anywhere]">
                          <span className="font-semibold">{w("ask.gloss")}</span> {d.gloss}
                        </p>
                      ) : null}
                      {d.href ? (
                        <>
                          <Link href={d.href} prefetch={false} className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-lg border border-brand-edge bg-brand px-5 text-base font-semibold text-on-brand hover:brightness-95">
                            {w("ask.approve")}
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </Link>
                          <p className="mt-2 text-sm text-muted">{w("ask.approve.hint")}</p>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-muted">{w("ask.noscreen")}</p>
                      )}
                    </article>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {phase !== "asking" ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label={w("ask.title")}>
              {chips.map((c) => (
                <li key={c}>
                  <button type="button" onClick={() => void ask(c)} className={chip}>
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
