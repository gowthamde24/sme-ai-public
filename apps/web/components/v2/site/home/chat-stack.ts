/**
 * The four conversations of the home page's phone (owner, 21 Nov 2026: "a dynamic stack of chat in different languages", then "calls in the phone demo"): each is ONE conversation of a made-up business: first the CALL (the assistant's lines on the
 * left, labelled "AI assistant", the customer's on the right, with live captions), then the WhatsApp that follows up on what the call asked, then the card of what it found out (FOUND_KEYS). The assistant speaks only the product's four languages
 * (Telugu, Hindi, Kannada, English); the page claims no other. The first line of the call says who is speaking ("the AI assistant of <business>"). Spoken style, English business words in Latin. The business names are made up.
 * DRAFT (owner to read): the Telugu, Hindi and Kannada lines are drafts, listed in TELUGU-DRAFT.md and TRANSLATION-REVIEW.md.
 */
export type StackCode = "te" | "hi" | "kn" | "en";
export type StackLine = { from: "me" | "them"; time: string; text: string };
export type CallLine = { from: "me" | "them"; text: string };
export type StackChat = {
  code: StackCode;
  name: string;
  day: string;
  /** The call screen's own words, in the conversation's language: the customer's label, the live chip and the ended chip. */
  call: { you: string; live: string; ended: string; lines: CallLine[] };
  lines: StackLine[];
};
export const AI_LABEL = "AI assistant";

export const STACK: readonly StackChat[] = [
  {
    code: "te",
    name: "Bright Path Academy",
    day: "ఈ రోజు",
    call: {
      you: "మీరు",
      live: "Live captions",
      ended: "Call ముగిసింది",
      lines: [
        { from: "them", text: "నమస్తే అండీ, నేను Bright Path Academy AI assistant ని. ఏ course, ఎవరికి కావాలి?" },
        { from: "me", text: "మా అబ్బాయికి, Class 12. EAMCET weekend batch కావాలి." },
        { from: "them", text: "సరే అండీ. శనివారం 10 కి demo class కి రాగలరా?" },
        { from: "me", text: "సరే, వస్తాం." },
      ],
    },
    lines: [
      { from: "them", time: "9:41 am", text: "నమస్తే అండీ! ఇప్పుడే call లో మాట్లాడాం కదా. EAMCET weekend batch details ఇవిగో: శని, ఆది 9 నుంచి 1 వరకు." },
      { from: "me", time: "9:41 am", text: "చూశాను, శనివారం వస్తాం." },
      { from: "them", time: "9:42 am", text: "Done అండీ. శనివారం 10 కి మీ demo class book చేశాను." },
      { from: "me", time: "9:42 am", text: "Thank you అండీ!" },
    ],
  },
  {
    code: "hi",
    name: "Shree Homes",
    day: "आज",
    call: {
      you: "आप",
      live: "Live captions",
      ended: "Call खत्म हुई",
      lines: [
        { from: "them", text: "नमस्ते! मैं Shree Homes का AI assistant हूँ। आपको कौन सा flat चाहिए?" },
        { from: "me", text: "Kondapur में 2BHK, budget 80 लाख तक।" },
        { from: "them", text: "ठीक है। शनिवार 11 बजे site visit रख दें?" },
        { from: "me", text: "हाँ, शनिवार को आता हूँ।" },
      ],
    },
    lines: [
      { from: "them", text: "नमस्ते! अभी call पर बात हुई थी। 2BHK के photos और location यहाँ हैं।", time: "11:05 am" },
      { from: "me", time: "11:05 am", text: "मिल गए, शनिवार को आता हूँ।" },
      { from: "them", time: "11:06 am", text: "Done, शनिवार 11 बजे की site visit book हो गई।" },
      { from: "me", time: "11:06 am", text: "Thanks!" },
    ],
  },
  {
    code: "kn",
    name: "Sunrise Clinic",
    day: "ಇಂದು",
    call: {
      you: "ನೀವು",
      live: "Live captions",
      ended: "Call ಮುಗಿಯಿತು",
      lines: [
        { from: "them", text: "ನಮಸ್ಕಾರ! ನಾನು Sunrise Clinic ನ AI assistant. ನಿಮಗೆ ಏನು ಬೇಕು?" },
        { from: "me", text: "ನಾಳೆ ಬೆಳಿಗ್ಗೆ doctor appointment ಬೇಕು." },
        { from: "them", text: "ನಾಳೆ 10:30 ಕ್ಕೆ doctor ಇದ್ದಾರೆ. ಆಗುತ್ತದೆಯಾ?" },
        { from: "me", text: "ಹೌದು, book ಮಾಡಿ." },
      ],
    },
    lines: [
      { from: "them", time: "8:20 am", text: "ನಮಸ್ಕಾರ! ಈಗಷ್ಟೇ call ನಲ್ಲಿ ಮಾತನಾಡಿದೆವು. ನಿಮ್ಮ appointment details ಇವು." },
      { from: "me", time: "8:20 am", text: "ಸರಿ, ಬರುತ್ತೇನೆ." },
      { from: "them", time: "8:21 am", text: "Done, ನಾಳೆ 10:30 ಕ್ಕೆ ನಿಮ್ಮ appointment book ಆಗಿದೆ." },
      { from: "me", time: "8:21 am", text: "Thank you!" },
    ],
  },
  {
    code: "en",
    name: "Green Leaf Store",
    day: "Today",
    call: {
      you: "You",
      live: "Live captions",
      ended: "Call ended",
      lines: [
        { from: "them", text: "Hi! I am the AI assistant of Green Leaf Store. How can I help?" },
        { from: "me", text: "I want to know about my order." },
        { from: "them", text: "It is ready for pickup at the counter. Can you come today?" },
        { from: "me", text: "Yes, after 6 pm." },
      ],
    },
    lines: [
      { from: "them", time: "4:10 pm", text: "Hi! We just spoke on the call. Your order is ready, at the counter." },
      { from: "me", time: "4:10 pm", text: "Great, I will come after 6." },
      { from: "them", time: "4:11 pm", text: "Perfect, we are open until 8 pm. We will keep it for you." },
      { from: "me", time: "4:11 pm", text: "Thank you!" },
    ],
  },
];

/**
 * What the assistant found out in each conversation, in the same order as STACK: three rows each (a label and a value), words of the page's own language from the string store. The first set is the older `h3.how.f.*` rows
 * (the coaching centre); the others are `h3.found.<chat>.l.<row>` and `.v.<row>`. The card beside the phone shows the set of the chat that is on the phone, from the same state.
 */
export const FOUND_KEYS = [
  [1, 2, 3].map((m) => [`h3.how.f.${m}`, `h3.how.f.${m}.v`] as const),
  ...[2, 3, 4].map((n) => [1, 2, 3].map((m) => [`h3.found.${n}.l.${m}`, `h3.found.${n}.v.${m}`] as const)),
] as const;
