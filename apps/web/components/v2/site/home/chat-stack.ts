/**
 * The four conversations of the home page's phone (owner, 21 Nov 2026: "a dynamic stack of chat in different languages", then "calls in the phone demo"): each is ONE conversation of a made-up business: first the CALL (the assistant's lines on the
 * left, labelled "AI assistant", the customer's on the right, with live captions), then the WhatsApp that follows up on what the call asked, then the card of what it found out (FOUND_KEYS). The assistant speaks only the product's four languages
 * (Telugu, Hindi, Kannada, English); the page claims no other. The first line of the call says who is speaking: the name only ("Priya from <business>"); with the greeting switch on it is "the AI assistant of <business>" (GREETING_MENTIONS_AI). Spoken style, English business words in Latin. The business names are made up.
 * DRAFT (owner to read): the Telugu, Hindi and Kannada lines are drafts, listed in TELUGU-DRAFT.md and TRANSLATION-REVIEW.md.
 */
import { AI_LABEL, type CallLine, type StackChat, type StackCode, type StackLine } from "./chat-types";

export { AI_LABEL };
export type { CallLine, StackChat, StackCode, StackLine };

/**
 * THE ONE SWITCH of the demo. The product's setting "Say 'AI assistant' when greeting" is live and its default is OFF (owner, 20 Nov 2026; C1's docs/contracts/greeting-disclosure.md): a greeting is the name only ("Hello, this is Priya from Green Leaf Store"), and a customer who ASKS
 * always gets the honest answer that it is the business's AI assistant. So the demo's first call line is name-only (NAME_ONLY_GREETING) and the FAQ answer is the prepared "If they ask, it always says so honestly. You choose whether it mentions it in the greeting." (h4.faq.2.*.quiet).
 * Set this to true to show the other greeting ("I am the AI assistant of <business>"): both are tested. The small "AI assistant" speaker LABEL on the caption bubbles stays in both modes.
 */
export const GREETING_MENTIONS_AI = false;

/** The name-only first line of each call (the alternative to "I am the AI assistant of <business>"), same order as STACK: spoken style, drafts for the owner's read. */
const NAME_ONLY_GREETING: Record<StackCode, string> = {
  te: "నమస్తే అండీ, నేను Bright Path Academy నుంచి Priya. ఏ course, ఎవరికి కావాలి?",
  hi: "नमस्ते! मैं Shree Homes से Priya बोल रही हूँ। बताइए, आपको किस तरह का flat चाहिए?",
  kn: "ನಮಸ್ಕಾರ! ನಾನು Sunrise Clinic ಇಂದ Priya ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ. ಹೇಗೆ help ಮಾಡಲಿ?",
  en: "Hi! This is Priya from Green Leaf Store. How can I help?",
};

/** The conversations with the first call line in the chosen style (a pure function so a test can show both). */
export function stackWith(mentionsAi: boolean): readonly StackChat[] {
  if (mentionsAi) return STACK_TODAY;
  return STACK_TODAY.map((c) => ({ ...c, call: { ...c.call, lines: c.call.lines.map((l, i) => (i === 0 ? { ...l, text: NAME_ONLY_GREETING[c.code] } : l)) } }));
}


const STACK_TODAY: readonly StackChat[] = [
  {
    code: "te",
    name: "Bright Path Academy",
    place: "Hyderabad",
    day: "ఈరోజు",
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
    place: "Hyderabad",
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
      { from: "them", text: "नमस्ते! अभी call पर बात हुई थी। ये रहे 2BHK के photos और location।", time: "11:05 am" },
      { from: "me", time: "11:05 am", text: "मिल गए, शनिवार को आता हूँ।" },
      { from: "them", time: "11:06 am", text: "Done, शनिवार 11 बजे की site visit book हो गई।" },
      { from: "me", time: "11:06 am", text: "Thanks!" },
    ],
  },
  {
    code: "kn",
    name: "Sunrise Clinic",
    place: "Bengaluru",
    day: "ಇವತ್ತು",
    call: {
      you: "ನೀವು",
      live: "Live captions",
      ended: "Call ಮುಗಿಯಿತು",
      lines: [
        { from: "them", text: "ನಮಸ್ಕಾರ! ನಾನು Sunrise Clinic ನ AI assistant. ನಿಮಗೆ ಏನು ಬೇಕು?" },
        { from: "me", text: "ನಾಳೆ ಬೆಳಿಗ್ಗೆ doctor appointment ಬೇಕು." },
        { from: "them", text: "ನಾಳೆ 10:30 ಕ್ಕೆ doctor ಇದ್ದಾರೆ, ನಿಮಗೆ ಓಕೆ ನಾ?" },
        { from: "me", text: "ಹೌದು, book ಮಾಡಿ." },
      ],
    },
    lines: [
      { from: "them", time: "8:20 am", text: "ನಮಸ್ಕಾರ! ಈಗಷ್ಟೇ call ನಲ್ಲಿ ಮಾತಾಡಿದ್ವಿ ಅಲ್ವಾ. ನಿಮ್ಮ appointment details ಇಲ್ಲಿದೆ ನೋಡಿ." },
      { from: "me", time: "8:20 am", text: "ಸರಿ, ಬರ್ತೀನಿ." },
      { from: "them", time: "8:21 am", text: "Done, ನಾಳೆ 10:30 ಕ್ಕೆ ನಿಮ್ಮ appointment book ಆಗಿದೆ." },
      { from: "me", time: "8:21 am", text: "Thank you!" },
    ],
  },
  {
    code: "en",
    name: "Green Leaf Store",
    place: "Chennai",
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

export const STACK: readonly StackChat[] = stackWith(GREETING_MENTIONS_AI);

/**
 * What the assistant found out in each conversation, in the same order as STACK: three rows each (a label and a value), words of the page's own language from the string store. The first set is the older `h3.how.f.*` rows
 * (the coaching centre); the others are `h3.found.<chat>.l.<row>` and `.v.<row>`. The card beside the phone shows the set of the chat that is on the phone, from the same state.
 */
export const FOUND_KEYS = [
  [1, 2, 3].map((m) => [`h3.how.f.${m}`, `h3.how.f.${m}.v`] as const),
  ...[2, 3, 4].map((n) => [1, 2, 3].map((m) => [`h3.found.${n}.l.${m}`, `h3.found.${n}.v.${m}`] as const)),
] as const;
