import type { PlanWhen } from "@/lib/api/plan-when";

/**
 * The time phrase of a plan card, written in the CONVERSATION's language from the structured `when` the API sends (India time, minutes since midnight):
 * "సాయంత్రం 6 గంటలకి", "ఈ రోజు ఉదయం 10 నుండి సాయంత్రం 7 వరకు", "today, 10 am to 7 pm". Pure. A language without words here (ta, ml, mr: their review sheets are not done) reads in English.
 * `today` is today's India date (YYYY-MM-DD): "today" and "tomorrow" are words, any other day is "14 Nov".
 */
export type ConvLang = "en" | "te" | "hi" | "kn";
export const CONV_LANGS: readonly ConvLang[] = ["en", "te", "hi", "kn"];
export const convLangOf = (code: string | null | undefined): ConvLang => ((CONV_LANGS as readonly string[]).includes(code ?? "") ? (code as ConvLang) : "en");

type Part = "morning" | "noon" | "evening" | "night";
const partOf = (h: number): Part => (h >= 5 && h < 12 ? "morning" : h >= 12 && h < 16 ? "noon" : h >= 16 && h < 20 ? "evening" : "night");

const WORDS: Record<ConvLang, { part: Record<Part, string>; today: string; tomorrow: string; months: readonly string[] }> = {
  en: { part: { morning: "", noon: "", evening: "", night: "" }, today: "today", tomorrow: "tomorrow", months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] },
  te: { part: { morning: "ఉదయం", noon: "మధ్యాహ్నం", evening: "సాయంత్రం", night: "రాత్రి" }, today: "ఈ రోజు", tomorrow: "రేపు", months: ["జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జులై", "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్"] },
  hi: { part: { morning: "सुबह", noon: "दोपहर", evening: "शाम", night: "रात" }, today: "आज", tomorrow: "कल", months: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"] },
  kn: { part: { morning: "ಬೆಳಿಗ್ಗೆ", noon: "ಮಧ್ಯಾಹ್ನ", evening: "ಸಂಜೆ", night: "ರಾತ್ರಿ" }, today: "ಇಂದು", tomorrow: "ನಾಳೆ", months: ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"] },
};

/** The clock number in 12-hour form: whole hours as "6", others as "6:30" (a minute is never dropped). */
const hourText = (minute: number): string => {
  const h24 = Math.floor(minute / 60);
  const m = minute % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
};
const dayShift = (iso: string, by: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

function dateWord(date: string, today: string, lang: ConvLang): string {
  const w = WORDS[lang];
  if (date === today) return w.today;
  if (date === dayShift(today, 1)) return w.tomorrow;
  const month = w.months[Number(date.slice(5, 7)) - 1] ?? "";
  const day = Number(date.slice(8, 10));
  return `${day} ${month}`;
}

/** One point in time: "సాయంత్రం 6 గంటలకి" (te), "शाम 6 बजे" (hi), "ಸಂಜೆ 6 ಗಂಟೆಗೆ" (kn), "6 pm" (en). */
function atText(minute: number, lang: ConvLang): string {
  const h24 = Math.floor(minute / 60);
  const w = WORDS[lang].part[partOf(h24)];
  const n = hourText(minute);
  if (lang === "en") return `${n} ${h24 < 12 ? "am" : "pm"}`;
  if (lang === "te") return `${w} ${n} గంటలకి`;
  if (lang === "hi") return `${w} ${n} बजे`;
  return `${w} ${n} ಗಂಟೆಗೆ`;
}
/** The two ends of a stretch: "ఉదయం 10 నుండి సాయంత్రం 7 వరకు", "सुबह 10 से शाम 7 बजे तक", "ಬೆಳಿಗ್ಗೆ 10 ರಿಂದ ಸಂಜೆ 7 ರವರೆಗೆ", "10 am to 7 pm". */
function rangeText(from: number, to: number, lang: ConvLang): string {
  const p = (m: number) => {
    const h24 = Math.floor(m / 60);
    return lang === "en" ? `${hourText(m)} ${h24 < 12 ? "am" : "pm"}` : `${WORDS[lang].part[partOf(h24)]} ${hourText(m)}`;
  };
  if (lang === "en") return `${p(from)} to ${p(to)}`;
  if (lang === "te") return `${p(from)} నుండి ${p(to)} వరకు`;
  if (lang === "hi") return `${p(from)} से ${p(to)} बजे तक`;
  return `${p(from)} ರಿಂದ ${p(to)} ರವರೆಗೆ`;
}

export function formatWhen(when: PlanWhen, code: string | null | undefined, today: string): string {
  const lang = convLangOf(code);
  const day = dateWord(when.date, today, lang);
  const time = when.toMinute !== null && when.toMinute > when.fromMinute ? rangeText(when.fromMinute, when.toMinute, lang) : atText(when.fromMinute, lang);
  return lang === "en" ? `${day}, ${time}` : `${day} ${time}`;
}
