"use client";

import { ChevronDown, Languages } from "lucide-react";

import { CHAT_LANGS, type ChatLang } from "./chat-language";

/**
 * The language pill (owner 31 Oct): a small rounded pill that shows the chosen language in its own script ("తెలుగు ▾") and opens the system's own picker (a real select laid over the pill: the right control on a phone, and a keyboard works as it does
 * everywhere). `label` is its accessible name, `auto` the word for Auto in the person's language.
 */
export function LanguagePill({ value, onChange, label, auto, className = "" }: { value: ChatLang; onChange: (l: ChatLang) => void; label: string; auto: string; className?: string }) {
  const shown = (code: ChatLang) => CHAT_LANGS.find((l) => l.code === code)?.native ?? auto;
  return (
    <label data-chat="language" className={`relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-edge bg-surface pl-2.5 pr-2 text-sm font-semibold text-ink focus-within:border-brand-edge hover:bg-surface-2 ${className}`}>
      <Languages className="size-4 text-muted" aria-hidden="true" />
      <span aria-hidden="true" lang={value === "auto" ? undefined : value}>{shown(value)}</span>
      <ChevronDown className="size-4 text-muted" aria-hidden="true" />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ChatLang)} className="absolute inset-0 w-full cursor-pointer appearance-none rounded-full bg-transparent text-base opacity-0">
        {CHAT_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native ?? auto}
          </option>
        ))}
      </select>
    </label>
  );
}
