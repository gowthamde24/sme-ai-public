import type { SiteKey } from "@/i18n/site";

/**
 * The words and shapes of the home page that are DATA, so a headline or an example can change without touching a component (night 5, landing v3: ~/Desktop/stack19-jobs/landing-v2). The page's own sentences are strings of
 * i18n/strings/site.json (`v3.*`); this file holds the example call (its Telugu lines with the English under each), which block of "a day with {brand}" has a small word under its time and which a card of its own, the
 * sources, the six greetings and the speed table. No business type is named here and no number is a claim about the product: the example has made-up names and the page says so.
 */

/** One line of the example call: who says it (the assistant `v`, the customer `c`), what they say in Telugu and the English under it. (No name: the assistant introduces itself the way the owner set it, and the example does not choose for them.) */
export type CallLine = { who: "v" | "c"; te: string; en: string };
export type CallStory = { id: string; lines: readonly CallLine[]; /** How long the call lasted, in seconds (the clock stops here). */ seconds: number };

export const CALL_STORIES: readonly CallStory[] = [
  {
    id: "site-visit",
    seconds: 108,
    lines: [
      { who: "v", te: "నమస్కారం అండీ, శ్రీ సాయి హోమ్స్ నుంచి మాట్లాడుతున్నాం. ఒక్క నిమిషం మాట్లాడొచ్చా?", en: "Hello, this is Sri Sai Homes. Do you have a minute?" },
      { who: "c", te: "హా చెప్పండి. 2BHK ఎంత అవుతుంది?", en: "Yes, tell me. How much is a 2BHK?" },
      { who: "v", te: "Kondapur లో 2BHK అరవై లక్షల నుంచి ఉందండీ. Photos WhatsApp లో పంపమంటారా?", en: "2BHKs in Kondapur start at 60 lakh. Shall I send photos on WhatsApp?" },
      { who: "c", te: "పంపండి. శనివారం చూడొచ్చా?", en: "Send them. Can I see it on Saturday?" },
    ],
  },
];

/** The six blocks of "a day with {brand}", in order. `small` = a word under the time (`v3.day.N.small`), `card` = the small example card under the text and its look. The words are `v3.day.N.*`. */
export const DAY_BLOCKS = [
  { n: 1, small: true, card: "found" },
  { n: 2, small: true, card: "wa" },
  { n: 3, small: true, card: null },
  { n: 4, small: false, card: "plain" },
  { n: 5, small: false, card: "wa" },
  { n: 6, small: true, card: null },
] as const;
export type DayBlock = (typeof DAY_BLOCKS)[number];

/** The places leads come from, as text chips (no logo of another company): what the product receives today (copy fix 28 Oct: nothing here says we search for leads, and no portal is named until its parser is checked on real mails). The words are `v3.src.<id>`. */
export const HAVE_SOURCES: readonly { id: string; key: SiteKey }[] = [
  { id: "website", key: "v3.src.website" },
  { id: "whatsapp", key: "v3.src.whatsapp" },
  { id: "missed", key: "v3.src.missed" },
  { id: "meta", key: "v3.src.meta" },
  { id: "sheets", key: "v3.src.sheets" },
  { id: "indiamart", key: "v3.src.indiamart" }, // not live until the installation has its key: said so
];
export const FIND_SOURCES = [1, 2, 3] as const;

/** The six greetings (the word in its own script, then its language's name `v3.lang.<code>`). */
export const GREETINGS = [
  { code: "te", word: "నమస్కారం" },
  { code: "ta", word: "வணக்கம்" },
  { code: "kn", word: "ನಮಸ್ಕಾರ" },
  { code: "ml", word: "നമസ്കാരം" },
  { code: "hi", word: "नमस्ते" },
  { code: "en", word: "Hello" },
] as const;

export const SPEED_ROWS = [1, 2, 3, 4] as const;
export const FAQ_ITEMS = [1, 2, 3, 4, 5] as const;
export const PROMISES = [1, 2, 3, 4] as const;
export const PLAN_LD_FEATURES = [1, 2, 3, 4, 5] as const;
export const PLAN_WF_FEATURES = [1, 2, 3, 4, 5] as const;
export const IND_POINTS = [1, 2, 3, 4] as const;
