import { sayLine } from "./lines";
import type { AssistantSettings, CallLang } from "./types";

/**
 * The simulated test call of Settings > AI assistant (job DQ part 3; contract-assistant-settings.md, `POST /test-call`): until telephony exists it is a SIMULATION: no call is made, nothing is sent or stored, and the answer is a
 * transcript of what the assistant would say and what it would record. The words it shows come from the API (or, in the test screens, from here), are untrusted text and are drawn as plain text, bounded.
 */
export type TestCall = {
  note: string;
  transcript: { speaker: "assistant" | "customer"; text: string }[];
  outcome: { outcome: "positive" | "negative" | "unclear"; category: string; reason: string } | null;
};
export type TestCallResult = { ok: true; call: TestCall } | { ok: false; error: "not_available" | "mfa" | "read_only" };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseTestCall(json: unknown): TestCall | null {
  if (!isRec(json) || json.mode !== "fake" || typeof json.note !== "string" || json.note.length > 400 || !Array.isArray(json.transcript) || json.transcript.length > 30) return null;
  const transcript: TestCall["transcript"] = [];
  for (const row of json.transcript) {
    if (!isRec(row) || (row.speaker !== "assistant" && row.speaker !== "customer") || typeof row.text !== "string" || row.text.length > 1000) return null;
    transcript.push({ speaker: row.speaker, text: row.text });
  }
  const o = json.outcome;
  const raw = isRec(o) ? o.outcome : null;
  const kind: NonNullable<TestCall["outcome"]>["outcome"] | null = raw === "positive" || raw === "negative" || raw === "unclear" ? raw : null;
  const outcome = kind !== null && isRec(o) && typeof o.category === "string" && /^[a-z_]{1,40}$/.test(o.category) && typeof o.reason === "string" && o.reason.length <= 300 ? { outcome: kind, category: o.category, reason: o.reason } : null;
  return { note: json.note, transcript, outcome };
}

const YES: Record<CallLang, string> = { en: "Yes, please send it.", te: "అవును, పంపండి.", hi: "हाँ, भेज दीजिए।", kn: "ಹೌದು, ಕಳುಹಿಸಿ.", ta: "ஆம், அனுப்புங்கள்.", ml: "ശരി, അയയ്ക്കൂ." };
const DONE: Record<CallLang, string> = { en: "I have sent it on WhatsApp. Thank you!", te: "వాట్సాప్‌లో పంపాను. ధన్యవాదాలు!", hi: "व्हाट्सऐप पर भेज दिया। धन्यवाद!", kn: "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿದ್ದೇನೆ. ಧನ್ಯವಾದಗಳು!", ta: "வாட்ஸ்அப்பில் அனுப்பினேன். நன்றி!", ml: "വാട്സ്ആപ്പിൽ അയച്ചിട്ടുണ്ട്. നന്ദി!" };

/** The fake of the test screens (ASSISTANT_SCREENS=mock): the opening line of the saved settings, a yes, a thank-you, and the outcome it would record. Nothing is called. */
export function mockTestCall(s: AssistantSettings, shop: string): TestCall {
  return {
    note: "This is a simulation. No call was made and nothing was sent or stored. A real test call to your own phone needs telephony, which is not built yet.",
    transcript: [
      { speaker: "assistant", text: sayLine(s.lang, s.style, s.name, shop) },
      { speaker: "customer", text: YES[s.lang] },
      { speaker: "assistant", text: DONE[s.lang] },
    ],
    outcome: { outcome: "positive", category: "interested", reason: "Showed interest or asked for details." },
  };
}
