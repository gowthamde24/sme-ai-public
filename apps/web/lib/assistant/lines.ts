import type { CallLang, Style } from "./types";

/**
 * The example line the assistant would say on a first call, for each language of the call and way of talking (job DM, the preview of Settings > AI assistant). They are the CONTENT of a call, in the language of the call, so they
 * are not interface strings (the interface words are in app.json). {name} is the assistant's name and {shop} the business's. The words "AI assistant" are in every line: they are always said. Neutral on purpose (an enquiry, the details
 * on WhatsApp): the lines name no product and no price. The Telugu, Hindi and Kannada lines are drafts for a native speaker to review.
 */
export const LINES: Record<CallLang, Record<Style, string>> = {
  te: {
    warm: "హలో! నేను {shop} AI అసిస్టెంట్ {name}. మీ ఎంక్వయిరీ గురించి కాల్ చేశాను. వివరాలు వాట్సాప్‌లో పంపమంటారా?",
    resp: "నమస్కారం గారు, నేను {shop} AI అసిస్టెంట్ {name}. మీ ఎంక్వయిరీ గురించి ఒక నిమిషం మాట్లాడవచ్చా?",
    quick: "హాయ్, {shop} AI అసిస్టెంట్ {name}. మీ ఎంక్వయిరీ గురించి కాల్. వివరాలు వాట్సాప్‌లో పంపనా?",
  },
  hi: {
    warm: "हैलो! मैं {shop} का AI असिस्टेंट {name} हूँ। आपकी पूछताछ के बारे में कॉल किया है। जानकारी व्हाट्सऐप पर भेज दूँ?",
    resp: "नमस्ते जी, मैं {shop} का AI असिस्टेंट {name} हूँ। आपकी पूछताछ के बारे में एक मिनट बात कर लूँ?",
    quick: "हाय, {shop} का AI असिस्टेंट {name}। आपकी पूछताछ पर कॉल है। जानकारी व्हाट्सऐप पर भेज दूँ?",
  },
  kn: {
    warm: "ಹಲೋ! ನಾನು {shop} ನ AI ಅಸಿಸ್ಟೆಂಟ್ {name}. ನಿಮ್ಮ ವಿಚಾರಣೆ ಬಗ್ಗೆ ಕಾಲ್ ಮಾಡಿದ್ದೇನೆ. ವಿವರ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಲೇ?",
    resp: "ನಮಸ್ಕಾರ, ನಾನು {shop} ನ AI ಅಸಿಸ್ಟೆಂಟ್ {name}. ನಿಮ್ಮ ವಿಚಾರಣೆ ಬಗ್ಗೆ ಒಂದು ನಿಮಿಷ ಮಾತನಾಡಬಹುದೇ?",
    quick: "ಹಾಯ್, {shop} ನ AI ಅಸಿಸ್ಟೆಂಟ್ {name}. ನಿಮ್ಮ ವಿಚಾರಣೆ ಬಗ್ಗೆ ಕಾಲ್. ವಿವರ ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಕಳುಹಿಸಲೇ?",
  },
  en: {
    warm: "Hello! I'm {name}, the AI assistant at {shop}. I'm calling about your enquiry. Shall I send the details on WhatsApp?",
    resp: "Namaste, I'm {name}, the AI assistant of {shop}. May I take a minute to talk about your enquiry?",
    quick: "Hi, {name} here, AI assistant at {shop}. Calling about your enquiry. Details on WhatsApp?",
  },
};

/** The line for a language and way of talking, with the name and the business filled in. */
export const sayLine = (lang: CallLang, style: Style, name: string, shop: string): string => LINES[lang][style].replaceAll("{name}", name).replaceAll("{shop}", shop);
