import { DEFAULT_ASSISTANT_NAME } from "./name";
import type { CallLang, Style } from "./types";

/**
 * The example line the assistant would say on a first call, for each language of the call and way of talking (job DM, the preview of Settings > AI assistant). They are the CONTENT of a call, in the language of the call, so they
 * are not interface strings (the interface words are in app.json). {name} is the assistant's name and {shop} the business's. The words "AI assistant" are in every line: they are always said. Neutral on purpose (an enquiry, the details
 * on WhatsApp): the lines name no product and no price. The Telugu, Hindi, Kannada, Tamil and Malayalam lines are drafts for a native speaker to review.
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
  ta: {
    warm: "வணக்கம்! நான் {shop}-இன் AI உதவியாளர் {name}. உங்கள் விசாரணை பற்றி அழைக்கிறேன். விவரங்களை வாட்ஸ்அப்பில் அனுப்பட்டுமா?",
    resp: "வணக்கம், நான் {shop}-இன் AI உதவியாளர் {name}. உங்கள் விசாரணை பற்றி ஒரு நிமிடம் பேசலாமா?",
    quick: "ஹாய், {shop}-இன் AI உதவியாளர் {name}. உங்கள் விசாரணை பற்றிய அழைப்பு. விவரம் வாட்ஸ்அப்பில் அனுப்பவா?",
  },
  ml: {
    warm: "ഹലോ! ഞാൻ {shop}-ന്റെ AI അസിസ്റ്റന്റ് {name}. നിങ്ങളുടെ അന്വേഷണത്തെക്കുറിച്ച് വിളിക്കുകയാണ്. വിവരങ്ങൾ വാട്സ്ആപ്പിൽ അയയ്ക്കട്ടേ?",
    resp: "നമസ്കാരം, ഞാൻ {shop}-ന്റെ AI അസിസ്റ്റന്റ് {name}. നിങ്ങളുടെ അന്വേഷണത്തെക്കുറിച്ച് ഒരു മിനിറ്റ് സംസാരിക്കാമോ?",
    quick: "ഹായ്, {shop}-ന്റെ AI അസിസ്റ്റന്റ് {name}. നിങ്ങളുടെ അന്വേഷണത്തെക്കുറിച്ചുള്ള വിളി. വിവരം വാട്സ്ആപ്പിൽ അയയ്ക്കട്ടേ?",
  },
  en: {
    warm: "Hello! I'm {name}, the AI assistant at {shop}. I'm calling about your enquiry. Shall I send the details on WhatsApp?",
    resp: "Namaste, I'm {name}, the AI assistant of {shop}. May I take a minute to talk about your enquiry?",
    quick: "Hi, {name} here, AI assistant at {shop}. Calling about your enquiry. Details on WhatsApp?",
  },
};

/**
 * The line for a language and way of talking, with the name and the business filled in. Until the owner names the assistant (the default name) the line names nobody: "I'm the AI assistant at Sri Silks" (owner, 28 Oct: no fixed name).
 */
export const sayLine = (lang: CallLang, style: Style, name: string, shop: string): string => {
  let line = LINES[lang][style];
  if (name === DEFAULT_ASSISTANT_NAME) line = line.replace("I'm {name}, the", "I'm the").replace("{name} here, AI assistant", "this is the AI assistant").replace(" {name}", "");
  return line.replaceAll("{name}", name).replaceAll("{shop}", shop);
};
