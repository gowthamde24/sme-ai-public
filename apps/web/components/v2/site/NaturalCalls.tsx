"use client";

import { useState } from "react";

import { Orb } from "@/components/v2/Orb";

export type VoiceLang = { code: string; label: string };
export type VoiceStyle = { key: string; label: string };
export type VoiceWords = { langs: string; styles: string; who: string; note: string };

/**
 * The "Natural AI calls" card of the home page (job DM): language tabs by way-of-talking tabs, and under them the line the assistant would say, with the AI circle speaking beside the name. It is only text: voices come with early
 * access, so there is no play button (a button that does nothing would be a promise). `lines[lang][style]` come from the server, each in its own language. Both rows are real tablists (arrow keys, Home and End move between tabs).
 */
export function NaturalCalls({ langs, styles, lines, words }: { langs: readonly VoiceLang[]; styles: readonly VoiceStyle[]; lines: Record<string, Record<string, string>>; words: VoiceWords }) {
  const [lang, setLang] = useState(langs[0].code);
  const [style, setStyle] = useState(styles[0].key);
  const styleLabel = styles.find((s) => s.key === style)?.label ?? "";
  const tabKey = (e: React.KeyboardEvent, i: number, n: number, set: (i: number) => void) => {
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    set(to);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  const tab = (on: boolean) => `min-h-11 rounded-full border px-4 text-sm font-semibold ${on ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`;
  return (
    <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-5 rounded-3xl border border-line bg-surface p-6 shadow-[0_30px_60px_rgba(30,30,36,0.08)] sm:p-7" data-part="natural-calls">
      <div role="tablist" aria-label={words.langs} className="flex flex-wrap gap-2">
        {langs.map((l, i) => (
          <button key={l.code} type="button" role="tab" lang={l.code} aria-selected={l.code === lang} tabIndex={l.code === lang ? 0 : -1} onClick={() => setLang(l.code)} onKeyDown={(e) => tabKey(e, i, langs.length, (k) => setLang(langs[k].code))} className={tab(l.code === lang)}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-4 py-1">
        <Orb px={64} state="speak" halo />
        <span className="flex min-w-0 flex-col gap-1">
          <strong className="text-[15px]">{words.who}</strong>
          <span className="text-[13px] text-muted">{styleLabel}</span>
        </span>
      </div>
      <p lang={lang} className="m-0 min-h-[6.6em] text-[19px] leading-[1.65] text-ink">
        “{lines[lang][style]}”
      </p>
      <div role="tablist" aria-label={words.styles} className="flex flex-wrap gap-2">
        {styles.map((s, i) => (
          <button key={s.key} type="button" role="tab" aria-selected={s.key === style} tabIndex={s.key === style ? 0 : -1} onClick={() => setStyle(s.key)} onKeyDown={(e) => tabKey(e, i, styles.length, (k) => setStyle(styles[k].key))} className={tab(s.key === style)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="m-0 text-xs text-muted">{words.note}</p>
    </div>
  );
}
