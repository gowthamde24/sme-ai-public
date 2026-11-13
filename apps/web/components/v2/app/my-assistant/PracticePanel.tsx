"use client";

import Link from "next/link";
import * as React from "react";

import { Orb } from "@/components/v2/Orb";
import type { PracticeTurn } from "@/lib/api/talk-training";
import type { CallLang } from "@/lib/assistant/types";

import type { PracticeError, PracticeFn } from "../assistant/TalkTraining";
import { TalkLiveBody } from "../ds/talk/TalkLive";
import { useTalkLive } from "../ds/talk/use-talk-live";
import { TeachThis, type TeachActions } from "../ds/TeachThis";
import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";

const TURNS = 20; // the contract's limit on the turns of a practice call
const unique = () => `practice-${Date.now().toString(36)}`;

/**
 * The Practice panel, on the RIGHT of every tab of My assistant (below the tab on a phone) (owner, 13 Nov 2026): the real orb; "Talk now" (the voice conversation IN PLACE, no popup; the voice is mocked on staging); "Call my phone" (the sandbox test call: it opens the Calls page's own test-call
 * form, which rings only a phone on the deployment's test list, never a customer's number); and the assistant's answers, each with "Teach this" (source "practice"; only the Owner and Admin get `teach`). Typing as a customer uses C1's practice endpoint, the same one as Talk training.
 * Nothing is called or sent from here. `practice` null = typing is not there; `testCallHref` null = test calls are not switched on, and the button says so.
 */
export function PracticePanel({ words, language, langName, practice, teach, testCallHref }: { words?: Words; language: CallLang; langName: string; practice: PracticeFn | null; teach: TeachActions | null; testCallHref: string | null }) {
  const t = makeT(words);
  const live = useTalkLive("practice");
  const [talkId, setTalkId] = React.useState("practice");
  const [typedId, setTypedId] = React.useState("practice");
  const [turns, setTurns] = React.useState<PracticeTurn[]>([]);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<PracticeError | null>(null);
  const [ended, setEnded] = React.useState(false);
  const [busy, start] = React.useTransition();
  const input = React.useRef<HTMLInputElement | null>(null);
  const full = turns.length + 1 > TURNS;
  const talk = () => {
    setTalkId(unique());
    live.start();
  };
  const send = () => {
    const line = text.trim();
    if (!practice || !line || busy || ended || full) return;
    const sid = turns.length === 0 ? unique() : typedId;
    if (turns.length === 0) setTypedId(sid);
    const next: PracticeTurn[] = [...turns, { who: "customer", text: line.slice(0, 400) }];
    setTurns(next);
    setText("");
    setError(null);
    start(async () => {
      const out = await practice(language, next, null).catch(() => ({ ok: false as const, error: "down" as const }));
      if (!out.ok) {
        setError(out.error);
        setTurns(turns);
        setText(line);
        return;
      }
      setTurns([...next, { who: "assistant", text: out.data.reply }]);
      if (out.data.ended || out.data.handover) setEnded(true);
    });
  };
  const again = () => {
    setTurns([]);
    setEnded(false);
    setError(null);
  };
  return (
    <aside id="mya-practice" data-part="practice-panel" aria-labelledby="mya-practice-h" className="ds-glow flex flex-col gap-4 rounded-2xl p-4 md:p-5">
      <div>
        <h2 id="mya-practice-h" className="font-display text-xl font-semibold">
          {t("mya.p.title")}
        </h2>
        <p className={fieldHelp}>{t("mya.p.sub")}</p>
      </div>
      {live.active ? (
        <TalkLiveBody
          live={live}
          words={words}
          language={langName}
          onType={() => {
            live.end();
            window.setTimeout(() => input.current?.focus(), 0);
          }}
          afterLine={(l, i) => (l.who === "assistant" ? <TeachThis words={words} source="practice" sourceId={talkId} lineIndex={i} line={l.text} actions={teach} /> : null)}
        />
      ) : (
        <div className="flex flex-col items-center gap-3" data-part="practice-idle">
          <Orb px={96} state="ambient" halo />
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={talk} data-part="practice-talk" className={btnMain}>
              {t("mya.p.talk")}
            </button>
            {testCallHref ? (
              <Link href={testCallHref} data-part="practice-call" className={btnQuiet}>
                {t("mya.p.call")}
              </Link>
            ) : (
              <button type="button" disabled data-part="practice-call" className={btnQuiet}>
                {t("mya.p.call")}
              </button>
            )}
          </div>
          <p className="m-0 text-center text-sm text-muted">{testCallHref ? t("mya.p.call.help") : t("mya.p.call.off")}</p>
        </div>
      )}
      <section aria-labelledby="mya-answers-h" data-part="practice-answers" className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 id="mya-answers-h" className="font-display text-lg font-semibold">
          {t("mya.p.answers")}
        </h3>
        {turns.length === 0 ? <p className="m-0 text-sm text-muted">{t("mya.p.hint")}</p> : null}
        {turns.length > 0 ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite" data-part="practice-turns">
            {turns.map((x, i) => (
              <li key={i} data-who={x.who} className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${x.who === "customer" ? "self-end bg-surface-2" : "self-start border border-line bg-brand-bg"}`}>
                <span className="block text-xs font-bold text-muted">{t(x.who === "customer" ? "tt.practice.you" : "tt.practice.ai")}</span>
                <span lang={language} className="[overflow-wrap:anywhere]">
                  {x.text}
                </span>
                {x.who === "assistant" ? <TeachThis words={words} source="practice" sourceId={typedId} lineIndex={i} line={x.text} actions={teach} /> : null}
              </li>
            ))}
          </ol>
        ) : null}
        {ended ? <p className="m-0 text-sm font-semibold text-muted">{t("tt.practice.ended")}</p> : null}
        {full && !ended ? <p className="m-0 text-sm text-muted">{t("tt.practice.full")}</p> : null}
        {error ? (
          <p role="alert" className={`${alertBox} m-0`}>
            {t(`tt.practice.err.${error}` as "tt.practice.err.down")}
          </p>
        ) : null}
        {practice && !ended && !full ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="mya-practice-in" className={fieldLabel}>
                {t("tt.practice.input")}
              </label>
              <input id="mya-practice-in" ref={input} lang={language} value={text} maxLength={400} disabled={busy} onChange={(e) => setText(e.target.value)} className={fieldInput} />
            </div>
            <button type="submit" disabled={busy || text.trim() === ""} className={btnMain}>
              {busy ? t("tt.practice.sending") : t("tt.practice.send")}
            </button>
          </form>
        ) : null}
        {turns.length > 0 ? (
          <button type="button" onClick={again} disabled={busy} className={`${btnQuiet} self-start`}>
            {t("tt.practice.again")}
          </button>
        ) : null}
      </section>
    </aside>
  );
}
