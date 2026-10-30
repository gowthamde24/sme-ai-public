"use client";

import * as React from "react";

import { postPronunciation } from "@/components/v2/app/assistant/pronunciation-post";
import type { VoiceLang } from "@/lib/browser-voice/protocol";
import { cleanText, SOUND_MAX, WORD_MAX } from "@/lib/pronunciation/types";

/** The words of a spoken message that could be said wrongly: plain words of 2+ characters, no markup or punctuation around them, each once, in order (at most 60). */
export function wordsOf(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.replace(/[*_`#>[\]()]/g, " ").split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (w.length < 2 || w.length > WORD_MAX || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= 60) break;
  }
  return out;
}

/**
 * "Mispronounced?" under a spoken message (owner, 30 Oct): tap it, tap the word that was said wrongly, type how it should sound, Save. The word joins the workspace's pronunciation list (Settings > AI assistant > Pronunciation), for the language of the message. It saves through a plain route
 * (`<base>/pronunciation`, not a server action: the chat is an open overlay). Only the Owner and Admin see it.
 */
export function Mispronounced({ text, language, endpoint, c, messageId }: { text: string; language: VoiceLang; endpoint: string; c: (key: string) => string; messageId?: string }) {
  const [open, setOpen] = React.useState(false);
  const [word, setWord] = React.useState<string | null>(null);
  const [sound, setSound] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const close = () => {
    setOpen(false);
    setWord(null);
    setSound("");
  };
  const save = async () => {
    if (word === null || cleanText(sound, SOUND_MAX) === null) return;
    setState("saving");
    try {
      const out = await postPronunciation(endpoint, { action: "save", word, sounds_like: sound, language, ...(messageId ? { message_id: messageId } : {}) });
      if (out !== "signin" && out.ok) {
        setState("saved");
        close();
      } else setState("error");
    } catch {
      setState("error");
    }
  };
  if (!open)
    return (
      <span className="mt-1 inline-flex flex-wrap items-center gap-2">
        <button type="button" data-chat="mis" onClick={() => { setState("idle"); setOpen(true); }} className="inline-flex min-h-8 items-center text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink">
          {c("bv.chat.mis")}
        </button>
        {state === "saved" ? <span role="status" data-chat="mis-saved" className="text-xs font-medium text-green-text">{c("bv.chat.mis.saved")}</span> : null}
      </span>
    );
  return (
    <div data-chat="mis-box" className="mt-2 flex flex-col gap-2 rounded-lg border border-line bg-surface p-2">
      <p className="text-sm font-semibold">{c("bv.chat.mis.pick")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {wordsOf(text).map((w) => (
          <li key={w}>
            <button type="button" data-chat="mis-word" aria-pressed={word === w} onClick={() => setWord(w)} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${word === w ? "border-brand-edge bg-brand text-on-brand" : "border-edge bg-surface text-ink hover:bg-surface-2"}`}>
              {w}
            </button>
          </li>
        ))}
      </ul>
      {word !== null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="mis-sound" className="text-sm font-semibold">{c("bv.chat.mis.sound")}</label>
          <input id="mis-sound" value={sound} maxLength={SOUND_MAX} onChange={(e) => setSound(e.target.value)} autoComplete="off" autoFocus className="min-h-11 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink" />
          <div className="flex gap-2">
            <button type="submit" data-chat="mis-save" disabled={state === "saving" || cleanText(sound, SOUND_MAX) === null} className="inline-flex min-h-10 items-center rounded-full border border-brand-edge bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50">
              {c("bv.chat.mis.save")}
            </button>
            <button type="button" onClick={close} className="inline-flex min-h-10 items-center rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2">
              {c("bv.chat.mis.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={close} className="self-start text-sm font-semibold text-muted underline underline-offset-2">
          {c("bv.chat.mis.cancel")}
        </button>
      )}
      {state === "error" ? <p role="alert" className="text-sm font-medium text-red-text">{c("bv.chat.mis.err")}</p> : null}
    </div>
  );
}
