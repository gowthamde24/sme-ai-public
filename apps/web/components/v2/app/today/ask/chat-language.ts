"use client";

import { useCallback, useSyncExternalStore } from "react";

import { isVoiceLang, type VoiceLang } from "@/lib/browser-voice/protocol";

/**
 * The language pill of the chat bar (owner 31 Oct): Auto, or one of the six languages the voice speaks. It starts as the workspace's/app language and is remembered for the person (until the API keeps it on the profile, in this browser).
 * It decides what is SENT: the language the assistant answers and speaks in (`reply`), and the language the recogniser is pinned to (`stt`: the words of Telugu, Hindi, Kannada ... come in their script from the first one; Auto = no pin, the API
 * detects it as before). Dictation, Live talk and the sheet on a phone all read the same choice.
 */
export type ChatLang = "auto" | VoiceLang;
/** The pill's options, in the owner's order, each in its own script (Auto is worded by the dictionary). */
export const CHAT_LANGS: readonly { code: ChatLang; native: string | null }[] = [
  { code: "auto", native: null },
  { code: "te", native: "తెలుగు" },
  { code: "en", native: "English" },
  { code: "hi", native: "हिंदी" },
  { code: "kn", native: "ಕನ್ನಡ" },
  { code: "ta", native: "தமிழ்" },
  { code: "ml", native: "മലയാളം" },
];
export type ChatLanguage = { pill: ChatLang; /** The language to answer and speak in (Auto: the app's). */ reply: VoiceLang; /** The language to pin the recogniser to; null = detect (Auto). */ stt: VoiceLang | null };

/** What a chat that has no pill (a test, an old call site) sends: the app language for the voice, the recogniser on detect. */
export const plainLanguage = (appLang: VoiceLang): ChatLanguage => ({ pill: "auto", reply: appLang, stt: null });
export const resolveLanguage = (pill: ChatLang, appLang: VoiceLang): ChatLanguage => (pill === "auto" ? plainLanguage(appLang) : { pill, reply: pill, stt: pill });

const KEY = "sme_chat_lang";
const listeners = new Set<() => void>();
const read = (): ChatLang | null => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "auto" || isVoiceLang(v) ? (v as ChatLang) : null;
  } catch {
    return null; // storage blocked: the pill follows the app language and forgets on reload
  }
};
let memory: ChatLang | null = null; // when storage cannot be written, the choice still holds for this visit
const subscribe = (l: () => void) => {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
};
const snapshot = (): ChatLang | null => read() ?? memory;

/** The chat's language choice: the pill's value, a setter that remembers it, and what to send. */
export function useChatLanguage(appLang: VoiceLang, saved: string | null = null, remember?: (l: ChatLang) => void): ChatLanguage & { set: (l: ChatLang) => void } {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const fromProfile: ChatLang | null = saved === "auto" || isVoiceLang(saved) ? (saved as ChatLang) : null;
  const set = useCallback((l: ChatLang) => {
    try {
      window.localStorage.setItem(KEY, l);
      memory = null;
    } catch {
      memory = l; // blocked: it holds for this visit only
    }
    listeners.forEach((f) => f());
    remember?.(l); // and the person's profile keeps it (best effort)
  }, [remember]);
  // what the person chose in this browser now; else what their profile says; else the app's language
  const pill = stored ?? fromProfile ?? appLang;
  return { ...resolveLanguage(pill, appLang), set };
}
