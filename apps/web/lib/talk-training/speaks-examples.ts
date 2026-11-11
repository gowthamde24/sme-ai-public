import type { ExampleLang, SpeakStyle, SpeakTone } from "./speaks";

/**
 * The example lines of "How your assistant speaks" (owner decision 11 Nov 2026): one sentence in each language for each tone and word style, about the same thing (inviting a customer to the shop on Saturday) so the choices can be compared. `{business}` is the
 * business's name. These are DRAFTS written for the layout: a native reader has not checked them (they are in the review sheet), and C1's contract may replace them with the API's own sample lines. English has one line for each tone (its two word styles are the same).
 * The English noun "assistant" stays in Latin letters in every language (C1's speaking-style contract).
 */
export const EXAMPLES: Record<ExampleLang, Partial<Record<SpeakTone, Partial<Record<SpeakStyle, string>>>>> = {
  en: {
    respectful: { everyday_mixed: "Good morning. This is the AI assistant of {business}. Would it be convenient for you to visit the shop on Saturday?", everyday_pure: "Good morning. This is the AI assistant of {business}. Would it be convenient for you to visit the shop on Saturday?" },
    friendly: { everyday_mixed: "Hi! This is the AI assistant of {business}. Would you like to drop by the shop on Saturday?", everyday_pure: "Hi! This is the AI assistant of {business}. Would you like to drop by the shop on Saturday?" },
  },
  te: {
    respectful: { everyday_mixed: "నమస్కారం అండీ. నేను {business} AI assistant ని. శనివారం షాప్‌కి రావడానికి మీకు వీలవుతుందా అండీ?", everyday_pure: "నమస్కారం అండీ. నేను {business} AI assistant ని. శనివారం దుకాణానికి రావడానికి మీకు వీలవుతుందా అండీ?" },
    friendly: { everyday_mixed: "హాయ్! నేను {business} AI assistant ని. శనివారం షాప్‌కి వస్తారా?", everyday_pure: "నమస్కారం! నేను {business} AI assistant ని. శనివారం దుకాణానికి వస్తారా?" },
  },
  kn: {
    respectful: { everyday_mixed: "ನಮಸ್ಕಾರ. ನಾನು {business} AI assistant. ಶನಿವಾರ ಶಾಪ್‌ಗೆ ಬರಲು ನಿಮಗೆ ಅನುಕೂಲವಾಗುತ್ತಾ?", everyday_pure: "ನಮಸ್ಕಾರ. ನಾನು {business} AI assistant. ಶನಿವಾರ ಅಂಗಡಿಗೆ ಬರಲು ನಿಮಗೆ ಅನುಕೂಲವಾಗುತ್ತದೆಯೇ?" },
    friendly: { everyday_mixed: "ಹಾಯ್! ನಾನು {business} AI assistant. ಶನಿವಾರ ಶಾಪ್‌ಗೆ ಬರ್ತೀರಾ?", everyday_pure: "ನಮಸ್ಕಾರ! ನಾನು {business} AI assistant. ಶನಿವಾರ ಅಂಗಡಿಗೆ ಬರುತ್ತೀರಾ?" },
  },
  hi: {
    respectful: { everyday_mixed: "नमस्ते जी, मैं {business} का AI assistant हूँ। क्या आप शनिवार को शॉप पर आ सकेंगे?", everyday_pure: "नमस्कार जी, मैं {business} का AI assistant हूँ। क्या आप शनिवार को दुकान पर पधार सकेंगे?" },
    friendly: { everyday_mixed: "हाय! मैं {business} का AI assistant हूँ। शनिवार को शॉप आ रहे हैं?", everyday_pure: "नमस्ते! मैं {business} का AI assistant हूँ। शनिवार को दुकान आएँगे?" },
  },
};

/** The example line for the chosen tone, word style and language, with the business's name in it (English when the language has none). */
export function exampleLine(tone: SpeakTone, words: SpeakStyle, lang: ExampleLang, business: string | null): string {
  const line = EXAMPLES[lang]?.[tone]?.[words] ?? EXAMPLES.en[tone]?.[words] ?? "";
  return line.replaceAll("{business}", business ?? "…");
}
