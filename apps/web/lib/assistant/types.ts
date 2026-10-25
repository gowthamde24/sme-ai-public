/**
 * How the AI assistant behaves on calls and voice replies (job DM, Settings > AI assistant): its name, voice, languages, way of talking, what it may do, when it hands over to the owner and the calling hours. These are the shapes the
 * screen edits; C1 stores them per workspace as data (it extends the voice data of job DJ), and until that exists the screen reads and keeps them in a cookie behind ASSISTANT_SCREENS=mock. Every value is checked (`parseSettings`): a
 * cookie, a form or an answer that is not in these shapes is ignored, never drawn. The words "AI assistant" are NOT a setting: customers always hear them after the name and the owner cannot remove them.
 */
/** The four stock voices and, once the Owner has made one with their consent (job DP), their own: `own_voice`. */
export const VOICES = ["female_warm", "female_clear", "male_calm", "male_lively", "own_voice"] as const;
export type Voice = (typeof VOICES)[number];
export const STYLES = ["warm", "resp", "quick"] as const;
export type Style = (typeof STYLES)[number];
export const CALL_LANGS = ["te", "hi", "kn", "en"] as const;
export type CallLang = (typeof CALL_LANGS)[number];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const NAME_MAX = 24;
export const SPEED = { min: 0.8, max: 1.2, step: 0.05 } as const;

export type AssistantSettings = {
  name: string;
  voice: Voice;
  lang: CallLang;
  autoSwitch: boolean;
  mixEnglish: boolean;
  style: Style;
  speed: number;
  may: { prices: boolean; visits: boolean; whatsapp: boolean; dues: boolean };
  /** The highest discount it may offer, in whole percent (0 = it may not offer one). */
  maxDiscount: number;
  handover: { owner: boolean; upset: boolean; /** In whole rupees; null = no limit. */ orderAbove: number | null };
  hours: { from: string; to: string; days: readonly Day[] };
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
/** The API takes calling hours from 09:00 to 21:00 in steps of 15 minutes only (job DO). */
export const HOURS = { min: "09:00", max: "21:00", stepMinutes: 15 } as const;
const TIME = /^(09|1\d|20):(00|15|30|45)$|^21:00$/;

/** A name a person may give the assistant: letters (any script), digits and spaces, at most NAME_MAX, at least one letter; no markup and no punctuation. */
export const validName = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && Array.from(v.trim()).length <= NAME_MAX && /^[\p{L}\p{M}\p{N} ]+$/u.test(v.trim()) && /\p{L}/u.test(v);

/** `value` as settings, or null when ANY part of it is not in its shape. (A value is never half-accepted.) */
export function parseSettings(value: unknown): AssistantSettings | null {
  if (!isRecord(value) || !isRecord(value.may) || !isRecord(value.handover) || !isRecord(value.hours)) return null;
  const { may, handover: h, hours } = value;
  const days = hours.days;
  if (!validName(value.name) || !oneOf(VOICES, value.voice) || !oneOf(CALL_LANGS, value.lang) || !oneOf(STYLES, value.style)) return null;
  if (!isBool(value.autoSwitch) || !isBool(value.mixEnglish) || typeof value.speed !== "number" || !(value.speed >= SPEED.min && value.speed <= SPEED.max)) return null;
  if (!isBool(may.prices) || !isBool(may.visits) || !isBool(may.whatsapp) || !isBool(may.dues)) return null;
  if (typeof value.maxDiscount !== "number" || !Number.isInteger(value.maxDiscount) || value.maxDiscount < 0 || value.maxDiscount > 50) return null;
  if (!isBool(h.owner) || !isBool(h.upset) || !(h.orderAbove === null || (typeof h.orderAbove === "number" && Number.isInteger(h.orderAbove) && h.orderAbove >= 0 && h.orderAbove <= 100_000_000))) return null;
  if (typeof hours.from !== "string" || !TIME.test(hours.from) || typeof hours.to !== "string" || !TIME.test(hours.to) || hours.from >= hours.to) return null;
  if (!Array.isArray(days) || days.length === 0 || days.length > 7 || !days.every((d) => oneOf(DAYS, d)) || new Set(days).size !== days.length) return null;
  return {
    name: value.name.trim(),
    voice: value.voice,
    lang: value.lang,
    autoSwitch: value.autoSwitch,
    mixEnglish: value.mixEnglish,
    style: value.style,
    speed: Math.round(value.speed * 100) / 100,
    may: { prices: may.prices, visits: may.visits, whatsapp: may.whatsapp, dues: may.dues },
    maxDiscount: value.maxDiscount,
    handover: { owner: h.owner, upset: h.upset, orderAbove: h.orderAbove },
    hours: { from: hours.from, to: hours.to, days: DAYS.filter((d) => (days as readonly string[]).includes(d)) },
  };
}
