"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { offerFromBusiness, SOUND_MAX, WORD_MAX, type Entry, type PronError, type PronList } from "@/lib/pronunciation/types";

import { fetchSound, postPronunciation, type Out } from "./pronunciation-post";
import { alertBox, btnMain, btnQuiet, fieldHelp, fieldInput, fieldLabel, okBox, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Settings > AI assistant > "Pronunciation" (job pronunciation-quality, owner 30 Oct): the words the assistant must say a certain way. One row per word ("Pochampally" sounds like "pochampalli") with "Hear it" in the voice the workspace chose and "Remove"; below it a small form to add
 * one (word, how it sounds, which language) with "Hear it" before saving, and the business's own words (its name, its town) offered as one-tap suggestions. Owner and Admin change it; the rest read. What the list shows is what the route answered, never what was typed.
 */
export function Pronunciation({ words, initial, canEdit, endpoint, previewEndpoint, langNames, defaultLang, businessName, city }: { words?: Words; initial: PronList; canEdit: boolean; endpoint: string; previewEndpoint: string; langNames: Record<CallLang, string>; defaultLang: CallLang; businessName: string; city: string | null }) {
  const t = makeT(words);
  const router = useRouter();
  const [items, setItems] = React.useState<Entry[]>(initial.items);
  const [word, setWord] = React.useState("");
  const [sound, setSound] = React.useState("");
  const [lang, setLang] = React.useState<CallLang | "all">("all");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<PronError | "hear" | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [hearing, setHearing] = React.useState<string | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const suggestions = offerFromBusiness(businessName, city, items, initial.suggestions);

  const post = async (body: Record<string, unknown>): Promise<Out> => {
    const r = await postPronunciation(endpoint, body);
    if (r === "signin") {
      router.push("/login");
      return { ok: false, error: "down" };
    }
    return r;
  };
  const hear = async (key: string, wordText: string, say: string, language: CallLang) => {
    audio.current?.pause();
    setError(null);
    setHearing(key);
    try {
      const blob = await fetchSound(`${previewEndpoint}?${new URLSearchParams({ lang: language, word: wordText, say })}`);
      if (blob === null) throw new Error("no sound");
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audio.current = a;
      a.onended = a.onerror = () => {
        URL.revokeObjectURL(url);
        setHearing(null);
      };
      await a.play();
    } catch {
      setHearing(null);
      setError("hear");
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await post({ action: "save", word, sounds_like: sound, language: lang === "all" ? null : lang });
    setBusy(false);
    if (r.ok && r.entry) {
      const e = r.entry;
      setItems((list) => (list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e]));
      setWord("");
      setSound("");
      setSaved(true);
    } else if (!r.ok) setError(r.error);
  };
  const remove = async (e: Entry) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await post({ action: "delete", id: e.id });
    setBusy(false);
    if (r.ok) setItems((list) => list.filter((x) => x.id !== e.id));
    else setError(r.error);
  };
  const hearLang: CallLang = lang === "all" ? defaultLang : lang;
  return (
    <section className={`${surface} flex flex-col gap-3`} aria-labelledby="pr-h" data-part="pronunciation">
      <h2 id="pr-h" className="text-lg font-semibold text-ink">{t("pr.title")}</h2>
      <p className="text-sm text-muted">{t("pr.what")}</p>
      {items.length === 0 ? <p className="text-sm text-muted" data-part="pron-empty">{t("pr.empty")}</p> : null}
      <ul className="flex flex-col gap-2" data-part="pron-list">
        {items.map((e) => (
          <li key={e.id} data-part="pron-row" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="min-w-0 text-base [overflow-wrap:anywhere]">
              <span className="font-semibold text-ink">{e.word}</span> <span className="text-muted">{t("pr.sounds")}</span> <span className="font-semibold text-ink">{e.soundsLike}</span>
              <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{e.language ? langNames[e.language] : t("pr.lang.all")}</span>
            </p>
            <span className="flex gap-2">
              <button type="button" data-part="pron-hear" className={btnQuiet} disabled={hearing !== null} onClick={() => void hear(e.id, e.word, e.soundsLike, e.language ?? defaultLang)}>
                {hearing === e.id ? t("pr.hearing") : t("pr.hear")}
              </button>
              {canEdit ? (
                <button type="button" data-part="pron-remove" className={btnQuiet} disabled={busy} aria-label={t("pr.remove.label", { word: e.word })} onClick={() => void remove(e)}>
                  {t("pr.remove")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="flex flex-col gap-3 border-t border-line pt-3"
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
        >
          {suggestions.length > 0 ? (
            <div data-part="pron-suggest">
              <p className="text-sm font-semibold text-ink">{t("pr.suggest")}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <li key={s.word}>
                    <button type="button" className="inline-flex min-h-10 items-center rounded-full border border-edge bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-surface-2" onClick={() => {
                        setWord(s.word);
                        if (s.soundsLike) setSound(s.soundsLike);
                      }}>
                      {s.word}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pr-word" className={fieldLabel}>{t("pr.word")}</label>
              <input id="pr-word" value={word} maxLength={WORD_MAX} onChange={(e) => setWord(e.target.value)} className={fieldInput} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="pr-sound" className={fieldLabel}>{t("pr.sound")}</label>
              <input id="pr-sound" value={sound} maxLength={SOUND_MAX} onChange={(e) => setSound(e.target.value)} className={fieldInput} autoComplete="off" />
              <p className={fieldHelp}>{t("pr.sound.help")}</p>
            </div>
          </div>
          <div>
            <label htmlFor="pr-lang" className={fieldLabel}>{t("pr.lang")}</label>
            <select id="pr-lang" value={lang} onChange={(e) => setLang(e.target.value as CallLang | "all")} className={fieldInput}>
              <option value="all">{t("pr.lang.all")}</option>
              {CALL_LANGS.map((l) => (
                <option key={l} value={l}>{langNames[l]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-part="pron-hear-new" className={btnQuiet} disabled={sound.trim() === "" || hearing !== null} onClick={() => void hear("new", word, sound, hearLang)}>
              {hearing === "new" ? t("pr.hearing") : t("pr.hear")}
            </button>
            <button type="submit" data-part="pron-save" className={btnMain} disabled={busy || word.trim() === "" || sound.trim() === ""}>
              {t("pr.save")}
            </button>
          </div>
        </form>
      ) : null}
      {saved ? <p role="status" className={okBox}>{t("pr.saved")}</p> : null}
      {error ? <p role="alert" className={alertBox}>{t(`pr.err.${error}` as "pr.err.down")}</p> : null}
    </section>
  );
}
