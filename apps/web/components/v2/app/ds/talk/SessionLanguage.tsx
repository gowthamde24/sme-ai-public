"use client";

import * as React from "react";

import { isVoiceLang, type VoiceLang } from "@/lib/browser-voice/protocol";

import { CHAT_LANGS } from "../../today/ask/chat-language";
import type { Say } from "../../words";
import type { TalkLive } from "./use-talk-live";

/**
 * The language of the live conversation, ON the bar (owner, 15 Nov 2026: it was a label that looked like a dropdown and did nothing). A real choice while the voice is real: English, Telugu, Hindi, Kannada and so on, or Auto (the
 * conversation follows the language the person speaks). A change goes to the API at once (`set_language`): what it listens for, what it answers in and the VOICE follow, with no new call. In the made-up conversation (no voice)
 * it stays a plain label. The names are written in their own script, as in the composer.
 */
export function SessionLanguage({ live, t, label, bar = false }: { live: Pick<TalkLive, "real" | "language" | "setLanguage">; t: Say; /** What the plain label says (the language the page started the conversation in). */ label: string; bar?: boolean }) {
  const [choice, setChoice] = React.useState<VoiceLang | "auto" | null>(null);
  const look = bar ? "rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink" : "rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm font-semibold";
  const set = live.setLanguage;
  if (!live.real || !set) {
    return (
      <span className={look} data-part="talk-language">
        {label} <span className="text-muted">▾</span>
      </span>
    );
  }
  const current: string = choice === "auto" ? "auto" : (live.language ?? choice ?? "en");
  return (
    <label data-part="talk-language" className={`inline-flex min-h-11 items-center ${look}`}>
      <span className="sr-only">{t("dst.lang.label")}</span>
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value;
          if (next !== "auto" && !isVoiceLang(next)) return;
          setChoice(next as VoiceLang | "auto");
          set(next as VoiceLang | "auto");
        }}
        className="cursor-pointer bg-transparent outline-none"
      >
        {CHAT_LANGS.filter((l) => l.code === "auto" || isVoiceLang(l.code)).map((l) => (
          <option key={l.code} value={l.code}>
            {l.native ?? t("dst.lang.auto")}
          </option>
        ))}
      </select>
    </label>
  );
}
