import { CALL_LANGS, type CallLang } from "@/lib/assistant/types";

/**
 * The opening line of a call (night 5, Settings > AI assistant > "Opening line"; job-landing-v2 C2 part 3). One text per call language, with four placeholders the call fills in: {customer} (the person called), {assistant} (the assistant's
 * name), {business} (the business's name) and {agent_role} (what the assistant is, in the language: "AI assistant"). A language with no text of its own uses the default of the API. A switch says whether the greeting MENTIONS that this is an
 * AI assistant (default on); turned off, the greeting is exactly the owner's words, and the assistant still answers honestly if it is asked. The same two settings can be overridden per campaign (Advanced). These are the shapes the screen reads;
 * every answer is checked (lib/api/opening-line.ts has the contract this assumes).
 */
export const PLACEHOLDERS = ["customer", "assistant", "business", "agent_role"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const LINE_MIN = 5;
export const LINE_MAX = 300;

/** The texts by language: a language that is not there follows the default (workspace) or the workspace's text (campaign). */
export type Lines = Partial<Record<CallLang, string>>;
export type OpeningLine = { lines: Lines; defaults: Record<CallLang, string>; mentionAi: boolean; fake: boolean };
/** A campaign's own: `lines` only for the languages it changes, `mentionAi` null = follows the workspace. `effective` is what the dialer uses. */
export type CampaignOpeningLine = { lines: Lines; mentionAi: boolean | null; effective: { lines: Record<CallLang, string>; mentionAi: boolean } };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The words a line may hold: text of 5 to 300 characters whose {placeholders} are only the four known ones. */
export function validLine(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < LINE_MIN || t.length > LINE_MAX) return false;
  return [...t.matchAll(/\{(\w*)\}/g)].every((m) => (PLACEHOLDERS as readonly string[]).includes(m[1])) && !/[<>]/.test(t);
}
/** The placeholders in a text that are not one of the four (for the message under the box). */
export const unknownPlaceholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w*)\}/g)].map((m) => m[1]).filter((n) => !(PLACEHOLDERS as readonly string[]).includes(n)))];

/** The text as the person will hear it, with made-up values for the four placeholders. A placeholder that is not one of the four is left as typed. */
export function fillOpening(text: string, values: Record<Placeholder, string>): string {
  return text.replace(/\{(\w*)\}/g, (m, k: string) => ((PLACEHOLDERS as readonly string[]).includes(k) ? values[k as Placeholder] : m));
}

function parseLines(v: unknown, what: string): Lines {
  if (!isRecord(v)) throw new Error(what);
  const out: Lines = {};
  for (const l of CALL_LANGS) {
    const x = v[l];
    if (x === undefined || x === null) continue;
    if (!validLine(x)) throw new Error(what);
    out[l] = x;
  }
  return out;
}
function parseFull(v: unknown, what: string): Record<CallLang, string> {
  const lines = parseLines(v, what);
  for (const l of CALL_LANGS) if (lines[l] === undefined) throw new Error(what);
  return lines as Record<CallLang, string>;
}
export function parseOpeningLine(json: unknown): OpeningLine | null {
  try {
    if (!isRecord(json) || typeof json.mention_ai !== "boolean") return null;
    return { lines: parseLines(json.lines, "lines"), defaults: parseFull(json.defaults, "defaults"), mentionAi: json.mention_ai, fake: json.fake === true };
  } catch {
    return null;
  }
}
export function parseCampaignOpeningLine(json: unknown): CampaignOpeningLine | null {
  try {
    if (!isRecord(json) || !isRecord(json.effective) || typeof json.effective.mention_ai !== "boolean") return null;
    if (json.mention_ai !== null && typeof json.mention_ai !== "boolean") return null;
    return { lines: parseLines(json.lines, "lines"), mentionAi: json.mention_ai as boolean | null, effective: { lines: parseFull(json.effective.lines, "effective"), mentionAi: json.effective.mention_ai } };
  } catch {
    return null;
  }
}

/** A spoken preview: a short audio the browser can play (base64, with its type), or none when the voice service is not on (the text preview is always there). */
export type Preview = { audio: { base64: string; mime: string; seconds: number } | null; fake: boolean };
export const AUDIO_MIMES = ["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4"] as const;
export function parsePreview(json: unknown): Preview | null {
  if (!isRecord(json)) return null;
  const fake = json.fake !== false;
  if (json.audio_base64 === null || json.audio_base64 === undefined) return { audio: null, fake };
  const seconds = json.seconds;
  if (typeof json.audio_base64 !== "string" || json.audio_base64.length > 4_000_000 || !/^[A-Za-z0-9+/=]+$/.test(json.audio_base64) || !(AUDIO_MIMES as readonly unknown[]).includes(json.mime) || typeof seconds !== "number" || !(seconds > 0 && seconds <= 60)) return null;
  return { audio: { base64: json.audio_base64, mime: json.mime as string, seconds }, fake };
}

/** The made-up values the preview and the placeholders' hint use, in each language: a customer's first name, what the assistant is, and a business. The assistant's name and the business are the workspace's own. */
export const SAMPLE_CUSTOMER: Record<CallLang, string> = { te: "రవి", hi: "रवि", kn: "ರವಿ", en: "Ravi", ta: "ரவி", ml: "രവി" };

/** The texts a mock keeps before the API is live (CALL: the real defaults come from C1). */
export const MOCK_DEFAULTS: Record<CallLang, string> = {
  en: "Hello {customer}, this is {assistant}, the {agent_role} of {business}. Do you have a minute?",
  te: "నమస్కారం {customer} గారూ, నేను {assistant}, {business} {agent_role}. ఒక్క నిమిషం మాట్లాడొచ్చా?",
  hi: "नमस्ते {customer} जी, मैं {assistant}, {business} की {agent_role} बोल रही हूँ। क्या एक मिनट बात हो सकती है?",
  kn: "ನಮಸ್ಕಾರ {customer} ಅವರೇ, ನಾನು {assistant}, {business} ನ {agent_role}. ಒಂದು ನಿಮಿಷ ಮಾತನಾಡಬಹುದೇ?",
  ta: "வணக்கம் {customer}, நான் {assistant}, {business} நிறுவனத்தின் {agent_role}. ஒரு நிமிடம் பேசலாமா?",
  ml: "നമസ്കാരം {customer}, ഞാൻ {assistant}, {business} ന്റെ {agent_role}. ഒരു മിനിറ്റ് സംസാരിക്കാമോ?",
};

/** What the assistant is, in each language, for {agent_role} in the preview (the call says it in the language it speaks). */
export const SAMPLE_ROLE: Record<CallLang, string> = { en: "AI assistant", te: "AI అసిస్టెంట్", hi: "AI असिस्टेंट", kn: "AI ಅಸಿಸ್ಟೆಂಟ್", ta: "AI உதவியாளர்", ml: "AI അസിസ്റ്റന്റ്" };
