/**
 * The four conversations of the home page's chat stack (owner, 21 Nov 2026: "a dynamic stack of chat in different languages"). The assistant answers in the product's four languages only (Telugu, Hindi, Kannada, English); the page does
 * not claim any other. Each conversation is a different kind of business (a coaching centre, real estate, a clinic, a shop), the first line says who is speaking ("the AI assistant of <business>"), and the lines are spoken-style with
 * English business words in Latin. The business names are made up. DRAFT (owner to read): the Telugu, Hindi and Kannada lines are drafts, listed in TELUGU-DRAFT.md and TRANSLATION-REVIEW.md.
 */
export type StackCode = "te" | "hi" | "kn" | "en";
export type StackLine = { from: "me" | "them"; time: string; text: string };
export type StackChat = { code: StackCode; name: string; day: string; lines: StackLine[] };

export const STACK: readonly StackChat[] = [
  {
    code: "te",
    name: "Bright Path Academy",
    day: "ఈ రోజు",
    lines: [
      { from: "them", time: "9:41 am", text: "నమస్తే అండీ! నేను Bright Path Academy AI assistant ని. మీరు EAMCET batch గురించి అడిగారు కదా?" },
      { from: "me", time: "9:41 am", text: "అవును, weekend batch ఉందా?" },
      { from: "them", time: "9:42 am", text: "ఉందండీ, శని, ఆది 9 నుంచి 1 వరకు. శనివారం 10 కి demo class ఉంది, book చేయమంటారా?" },
      { from: "me", time: "9:42 am", text: "సరే, book చేయండి." },
      { from: "them", time: "9:42 am", text: "Done అండీ. శనివారం 10 కి మిమ్మల్ని చూస్తాం." },
    ],
  },
  {
    code: "hi",
    name: "Shree Homes",
    day: "आज",
    lines: [
      { from: "them", time: "11:05 am", text: "नमस्ते! मैं Shree Homes का AI assistant हूँ। आपने 2BHK के बारे में पूछा था, सही है?" },
      { from: "me", time: "11:05 am", text: "हाँ, Kondapur में चाहिए, budget 80 लाख तक।" },
      { from: "them", time: "11:06 am", text: "ठीक है। शनिवार 11 बजे site visit रख दें? Photos अभी WhatsApp पर आ रही हैं।" },
      { from: "me", time: "11:06 am", text: "ठीक है, शनिवार को आता हूँ।" },
      { from: "them", time: "11:06 am", text: "Done, शनिवार 11 बजे की site visit book हो गई।" },
    ],
  },
  {
    code: "kn",
    name: "Sunrise Clinic",
    day: "ಇಂದು",
    lines: [
      { from: "them", time: "8:20 am", text: "ನಮಸ್ಕಾರ! ನಾನು Sunrise Clinic ನ AI assistant. ನೀವು appointment ಬಗ್ಗೆ ಕೇಳಿದ್ದಿರಿ, ಸರಿನಾ?" },
      { from: "me", time: "8:20 am", text: "ಹೌದು, ನಾಳೆ ಬೆಳಿಗ್ಗೆ ಬರಬಹುದಾ?" },
      { from: "them", time: "8:21 am", text: "ಆಗುತ್ತದೆ. ನಾಳೆ ಬೆಳಿಗ್ಗೆ 10:30 ಕ್ಕೆ doctor ಇದ್ದಾರೆ. Book ಮಾಡಲಾ?" },
      { from: "me", time: "8:21 am", text: "ಸರಿ, book ಮಾಡಿ." },
      { from: "them", time: "8:21 am", text: "Done, ನಾಳೆ 10:30 ಕ್ಕೆ ನಿಮ್ಮ appointment book ಆಗಿದೆ." },
    ],
  },
  {
    code: "en",
    name: "Green Leaf Store",
    day: "Today",
    lines: [
      { from: "them", time: "4:10 pm", text: "Hi! I am the AI assistant of Green Leaf Store. You asked about your order." },
      { from: "me", time: "4:10 pm", text: "Yes, is it ready?" },
      { from: "them", time: "4:11 pm", text: "Good news, your order is ready for pickup. We are open until 8 pm today." },
      { from: "me", time: "4:11 pm", text: "Great, I will come after 6." },
      { from: "them", time: "4:11 pm", text: "Perfect, we will keep it at the counter for you." },
    ],
  },
];
