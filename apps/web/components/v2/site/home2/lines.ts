/**
 * What the AI assistant says in the home page's examples (landing v2): the design's own words, in the customer's language, the same in every language of the site (they are what a customer would hear, not the page's words).
 * They match the clips of C1's audio manifest word for word (public/audio/site/manifest.json: `hero-<code>`, `try-<code>`), so a clip's word times light these words. Every example is for a sample business and the page says so.
 * Pure data; the page's own words are in i18n/strings/site.json (`h2.*`).
 */
export type DemoLang = "te" | "ta" | "kn" | "ml" | "hi" | "mr" | "en";
/** In the design's order (the language buttons of "Try it" and the greetings band). */
export const DEMO_LANGS: readonly { code: DemoLang; label: string; word: string; hero: string; line: string }[] = [
  { code: "te", label: "తెలుగు", word: "నమస్కారం", hero: "నమస్కారం! మీరు అడిగిన దాని గురించి కాల్ చేస్తున్నాను.", line: "నమస్కారం! మీరు ఇప్పుడే పంపిన ఎంక్వైరీ గురించి కాల్ చేస్తున్నాను. ఇప్పుడు మాట్లాడొచ్చా?" },
  { code: "ta", label: "தமிழ்", word: "வணக்கம்", hero: "வணக்கம்! நீங்கள் கேட்டதைப் பற்றி அழைக்கிறேன்.", line: "வணக்கம்! நீங்கள் இப்போது அனுப்பிய விசாரணை பற்றி அழைக்கிறேன். இப்போது பேசலாமா?" },
  { code: "kn", label: "ಕನ್ನಡ", word: "ನಮಸ್ಕಾರ", hero: "ನಮಸ್ಕಾರ! ನೀವು ಕೇಳಿದ್ದರ ಬಗ್ಗೆ ಕಾಲ್ ಮಾಡುತ್ತಿದ್ದೇನೆ.", line: "ನಮಸ್ಕಾರ! ನೀವು ಈಗ ಕಳಿಸಿದ ವಿಚಾರಣೆಯ ಬಗ್ಗೆ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತಾಡಬಹುದಾ?" },
  { code: "ml", label: "മലയാളം", word: "നമസ്കാരം", hero: "നമസ്കാരം! നിങ്ങൾ ചോദിച്ചതിനെക്കുറിച്ച് വിളിക്കുന്നു.", line: "നമസ്കാരം! നിങ്ങൾ ഇപ്പോൾ അയച്ച അന്വേഷണത്തെക്കുറിച്ചാണ് വിളിക്കുന്നത്. ഇപ്പോൾ സംസാരിക്കാമോ?" },
  { code: "hi", label: "हिन्दी", word: "नमस्ते", hero: "नमस्ते! आपने जो पूछा, उसी बारे में कॉल कर रही हूँ।", line: "नमस्ते! आपने अभी जो पूछताछ भेजी, उसी के बारे में कॉल कर रही हूँ। अभी बात कर सकते हैं?" },
  { code: "mr", label: "मराठी", word: "नमस्कार", hero: "नमस्कार! तुम्ही विचारलेल्या गोष्टीबद्दल कॉल करत आहे.", line: "नमस्कार! तुम्ही आत्ता पाठवलेल्या चौकशीबद्दल कॉल करत आहे. आता बोलू शकतो का?" },
  { code: "en", label: "English", word: "Hello", hero: "Hello! I am calling about what you just asked.", line: "Hello! I am calling about the enquiry you just sent. Is now a good time to talk?" },
];

/** "Try it": each sample business, the source its enquiry comes from (0..5, the stage's chips) and the outcome chip it lights (0..2). */
export const TRY_BIZ = ["saree", "build", "coach"] as const;
export type TryBiz = (typeof TRY_BIZ)[number];
export const TRY_ROUTE: Record<TryBiz, { src: number; out: number }> = { saree: { src: 0, out: 2 }, build: { src: 1, out: 1 }, coach: { src: 2, out: 2 } };

/** The stage's drawing space (the design's 1240 × 540): where the six sources stand, and the three outcomes. */
export const STAGE_W = 1240;
export const STAGE_H = 540;
export const SRC_Y = [50, 134, 218, 302, 386, 470] as const;
export const SRC_LEFT = [24, 62, 92, 92, 62, 24] as const;
export const OUT_Y = [108, 238, 368] as const;

/** Word count of a line, the way the captions split it (on spaces). */
export const wordsOf = (text: string): string[] => text.split(" ");

/**
 * "Hear a call": the three sample calls (the design's BIZ lines), each said by the AI assistant (`ai`) or the customer, in the customer's language; the English under each is a page word (`h2.call.<biz>.<n>.en`, in the site's
 * language). Line n of a call is C1's clip `call-<biz>-<n>`. The businesses (Padma Silks, Ganga Pavers, Bright Path Academy) and the customers are made up, and the page says so.
 */
export const CALL_BIZ = ["saree", "build", "coach"] as const;
export type CallBiz = (typeof CALL_BIZ)[number];
export const CALLS: Record<CallBiz, { lang: DemoLang; lead: string; lines: { ai: boolean; text: string }[] }> = {
  saree: {
    lang: "te",
    lead: "Lakshmi",
    lines: [
      { ai: true, text: "నమస్కారం! నేను పద్మ సిల్క్స్ AI అసిస్టెంట్‌ని. మీరు పట్టు చీరల గురించి అడిగారు కదా?" },
      { ai: false, text: "అవును, పెళ్లి కోసం కంచి పట్టు చీర కావాలి. బడ్జెట్ పదిహేను వేల వరకు." },
      { ai: true, text: "చాలా బాగుంది. ఏ రంగు ఇష్టం? ఎరుపు, ఆకుపచ్చ, లేక పసుపు?" },
      { ai: false, text: "ఎరుపు. ఫోటోలు వాట్సాప్‌లో పంపగలరా?" },
      { ai: true, text: "తప్పకుండా, ఇప్పుడే పంపుతాను. శనివారం షాప్‌కి వచ్చి చూస్తారా?" },
      { ai: false, text: "సరే, పదకొండు గంటలకు వస్తాను." },
    ],
  },
  build: {
    lang: "hi",
    lead: "Imran",
    lines: [
      { ai: true, text: "नमस्ते! मैं गंगा पेवर्स की AI असिस्टेंट हूँ। आपने पेवर ब्लॉक्स के बारे में पूछा था?" },
      { ai: false, text: "हाँ, 1,200 स्क्वेयर फ़ीट पार्किंग के लिए चाहिए।" },
      { ai: true, text: "ठीक है। गाड़ियों के लिए 80 mm मोटाई चलेगी?" },
      { ai: false, text: "हाँ। डिलीवरी व्हाइटफ़ील्ड में होगी।" },
      { ai: true, text: "नोट कर लिया। कोटेशन बनाकर, मालिक के OK के बाद भेज दूँगी।" },
    ],
  },
  coach: {
    lang: "en",
    lead: "Rahul",
    lines: [
      { ai: true, text: "Hi Rahul, I am the AI assistant of Bright Path Academy. You asked about the evening CA Foundation batch?" },
      { ai: false, text: "Yes, I work during the day. What are the timings?" },
      { ai: true, text: "Evening batches run 6:30 to 8:30 pm, Monday to Friday. Would you like a free demo class first?" },
      { ai: false, text: "Yes, Wednesday. Send me the address on WhatsApp." },
      { ai: true, text: "Done, the address is on its way. See you Wednesday at 6:30." },
    ],
  },
};
