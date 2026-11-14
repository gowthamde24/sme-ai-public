/**
 * "How it talks to you" (owner item G, 14 Nov 2026; C1's contract docs/contracts/owner-talk-prefs.md): how the assistant talks to THIS person (not the business, and never the customers): the voice, the style,
 * what it calls the person, the words and the speed. Saved per USER; the voice per user AND language. The ids are C1's; the labels are ours (the words file, per language). Pure: parsers and filters only.
 */
export const TALK_LANGS = ["te", "kn", "hi", "en"] as const;
export type TalkLang = (typeof TALK_LANGS)[number];
export const isTalkLang = (v: unknown): v is TalkLang => (TALK_LANGS as readonly unknown[]).includes(v);

export const STYLES = ["friendly", "respectful", "very_formal", "short_direct"] as const;
export const ADDRESSES = ["by_name", "garu", "sir_madam", "anna_akka"] as const;
export const WORDS = ["pure", "mix", "more_english"] as const;
export const SPEEDS = ["slower", "normal", "faster"] as const;
export type Style = (typeof STYLES)[number];
export type Address = (typeof ADDRESSES)[number];
export type WordsChoice = (typeof WORDS)[number];
export type Speed = (typeof SPEEDS)[number];
export type Field = "voice" | "style" | "address" | "words" | "speed";
export const FIELDS: readonly Field[] = ["voice", "style", "address", "words", "speed"];

/** A new person starts here (C1: Respectful, by name, natural mix, normal speed). */
export const DEFAULTS = { style: "respectful", address: "by_name", words: "mix", speed: "normal" } as const satisfies { style: Style; address: Address; words: WordsChoice; speed: Speed };

export const VOICE_ID = /^[a-z]{2}-[a-z0-9_-]{2,40}$/;
export type Sound = "warm" | "calm" | "bright";
const SOUND_OF: Readonly<Record<string, Sound>> = { warm: "warm", calm: "calm", bright: "bright" };
export type TalkVoice = { id: string; name: string; sound: Sound | null; gender: "female" | "male"; sample: boolean };

export type TalkOptions = { voices: TalkVoice[]; style: Style[]; address: Address[]; words: WordsChoice[]; speed: Speed[] };
export type TalkPrefs = {
  language: TalkLang;
  voice: TalkVoice | null;
  style: Style;
  address: Address;
  words: WordsChoice;
  speed: Speed;
  isDefault: boolean;
  options: TalkOptions;
  /** After a save: the token that undoes it (15 minutes) and what changed; null on a plain read. */
  undoToken: string | null;
  changed: Field[];
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const one = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const many = <T extends string>(list: readonly T[], v: unknown): T[] => (Array.isArray(v) ? list.filter((x) => v.includes(x)) : []);

/** The address options that exist for a language (C1 leaves the others out; checked again here): `anna_akka` only te, kn, hi; `garu` only te, kn. */
export function addressFor(language: TalkLang, list: readonly Address[]): Address[] {
  return list.filter((a) => (a === "anna_akka" ? language === "te" || language === "kn" || language === "hi" : a === "garu" ? language === "te" || language === "kn" : true));
}

export function parseVoice(v: unknown): TalkVoice | null {
  if (!isRec(v) || typeof v.id !== "string" || !VOICE_ID.test(v.id)) return null;
  const gender = v.gender === "male" ? "male" : v.gender === "female" ? "female" : null;
  const name = typeof v.name === "string" ? v.name.slice(0, 60) : "";
  if (!gender || !name) return null;
  const label = typeof v.label === "string" ? v.label.toLowerCase() : "";
  return { id: v.id, name, sound: SOUND_OF[label] ?? null, gender, sample: v.sample !== false };
}

/** The answer of GET / PUT / undo, read strictly: an answer that does not read is null (the screen then says "not available", never a half-filled form). */
export function parseTalkPrefs(json: unknown, language: TalkLang): TalkPrefs | null {
  if (!isRec(json)) return null;
  const style = one(STYLES, json.style);
  const address = one(ADDRESSES, json.address);
  const words = one(WORDS, json.words);
  const speed = one(SPEEDS, json.speed);
  if (!style || !address || !words || !speed || !isRec(json.options)) return null;
  const o = json.options;
  const voices = Array.isArray(o.voices) ? o.voices.slice(0, 40).flatMap((x) => parseVoice(x) ?? []) : [];
  const options: TalkOptions = { voices, style: many(STYLES, o.style), address: addressFor(language, many(ADDRESSES, o.address)), words: many(WORDS, o.words), speed: many(SPEEDS, o.speed) };
  return {
    language,
    voice: json.voice === null || json.voice === undefined ? null : parseVoice(json.voice),
    style,
    address,
    words,
    speed,
    isDefault: json.is_default === true,
    options,
    undoToken: typeof json.undo_token === "string" && /^[\w-]{8,200}$/.test(json.undo_token) ? json.undo_token : null,
    changed: Array.isArray(json.changed) ? FIELDS.filter((f) => (json.changed as unknown[]).includes(f)) : [],
  };
}

/** One change the person makes: a field and the id/value. Checked again before it is sent. */
export type Patch = Partial<Record<Exclude<Field, "voice">, string>> & { voice?: string };
export function cleanPatch(raw: unknown): Patch | null {
  if (!isRec(raw)) return null;
  const out: Patch = {};
  let n = 0;
  if (raw.voice !== undefined) {
    if (typeof raw.voice !== "string" || !VOICE_ID.test(raw.voice)) return null;
    out.voice = raw.voice;
    n++;
  }
  for (const [field, list] of [["style", STYLES], ["address", ADDRESSES], ["words", WORDS], ["speed", SPEEDS]] as const) {
    if (raw[field] === undefined) continue;
    const v = one(list as readonly string[], raw[field]);
    if (!v) return null;
    out[field] = v;
    n++;
  }
  return n === 1 ? out : null; // one change at a time (one Undo each)
}
