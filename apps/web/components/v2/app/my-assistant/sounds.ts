import type { Gender, PickerLang, PickerVoice } from "@/lib/voice-picker/types";

/**
 * The three sounds of the voice cards (owner, 13 Nov 2026: "named by sound, no person names"): Warm, Calm, Bright. The voice catalogue (voice picker) tags every voice with plain style words; a card is the voice of the workspace's gender, in the language, that carries its tag. The
 * person's name of a voice is never shown. Pure: no React, no fetch.
 */
export const SOUNDS = ["warm", "calm", "bright"] as const;
export type Sound = (typeof SOUNDS)[number];

/** The voice a card plays and picks for a language: among the voices of the WORKSPACE'S gender (a voice of the other gender would not take effect: the picker ignores it) that carry the sound, the one in use, else one whose first tag is the sound, else a recommended one, else the default, else the first. null = no voice has that sound in that language. */
export function voiceFor(voices: readonly PickerVoice[], sound: Sound, language: PickerLang, gender: Gender, inUse: string | null): PickerVoice | null {
  const mine = voices.filter((v) => v.language === language && v.gender === gender && v.tags.includes(sound));
  return mine.find((v) => v.id === inUse) ?? mine.find((v) => v.tags[0] === sound) ?? mine.find((v) => v.recommended) ?? mine.find((v) => v.isDefault) ?? mine[0] ?? null;
}

/** The voice in force for a language (the one chosen if it is still in the catalogue, else the default of the gender), as the voice picker computes it. */
export function inUseId(voices: readonly PickerVoice[], choices: Partial<Record<PickerLang, string | null>>, language: PickerLang, gender: Gender): string | null {
  const mine = voices.filter((v) => v.language === language && v.gender === gender);
  return (mine.find((v) => v.id === choices[language]) ?? mine.find((v) => v.isDefault))?.id ?? null;
}
