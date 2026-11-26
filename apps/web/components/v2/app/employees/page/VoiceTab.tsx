"use client";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";

import { makeT } from "../../words";
import { LanguagesCard, SpeakCard } from "./SpeakCard";
import { VoiceLanguage } from "./VoiceLanguage";
import { Card, DefaultNote, type CatalogueVoice, type TabProps } from "./shared";
import { usePlayer } from "./usePlayer";

/**
 * Voice and language: the languages it speaks, then for EACH language the voice in use, the voices to choose (with Play), the opening line (with Play), and how it speaks (style, speed, switches). The main assistant's voice is set in My assistant: here it is only shown.
 */
export function VoiceTab(props: TabProps & { catalogue: readonly CatalogueVoice[] | null; sampleEndpoint: string }) {
  const { emp, words, base, catalogue } = props;
  const t = makeT(words);
  const player = usePlayer();
  if (emp.isDefault) {
    const names = (l: string) => catalogue?.find((v) => v.id === emp.voices[l])?.name ?? emp.voices[l] ?? t("emp.page.voice.none_short");
    return (
      <>
        <DefaultNote words={words} base={base} />
        <Card title={t("emp.page.voice.langs")}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-part="emp-default-voices">
            {emp.languages.map((l) => (
              <li key={l} className="text-base text-ink">
                <span className="font-semibold">{CALL_LANG_NAMES[l as CallLang] ?? l}</span>: {names(l)}
              </li>
            ))}
          </ul>
        </Card>
      </>
    );
  }
  return (
    <>
      <p className="m-0 text-[15px] text-muted" data-part="emp-per-language">
        {t("vc.per_language", { language: CALL_LANG_NAMES[(emp.languages[0] ?? "te") as CallLang] ?? "" })}
      </p>
      {player.problem ? (
        <p role="alert" data-part="emp-play-problem" className="m-0 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text">
          {player.problem === "sample" ? t("emp.page.voice.play_failed") : t(`emp.err.${player.problem}`)}
        </p>
      ) : null}
      <LanguagesCard {...props} />
      {emp.languages.map((l) => (
        <VoiceLanguage key={l} lang={l} {...props} player={player} />
      ))}
      <SpeakCard {...props} />
    </>
  );
}
