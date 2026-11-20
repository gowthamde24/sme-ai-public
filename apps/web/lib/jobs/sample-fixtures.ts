import type { SampleType } from "@/lib/screens/preview";

import { MOCK_ASSISTANT, MOCK_BUSINESS } from "./fixtures";

/**
 * THE SAMPLE BUSINESSES of the staging preview picker (lib/screens/preview.ts: the cookie `jobs:<word>`). Each is a whole made-up business for JOBS=mock: its name, its assistant, what it sells, the names of its jobs and the words its customers hear.
 * `saree` is the demo shop the mock always was (Neelambari Silks): its fixtures are written for it and are NOT changed. For the other three the saree wording of the fixtures is swapped for the business's own by `localize` (exact words of a job's name, and
 * whole phrases), and a test (lib/jobs/sample-fixtures.test.ts) proves that no saree word is left in anything the sample shows. SERVER ONLY (mock adapters); nothing here is sent or stored.
 * The customer message previews keep the contract's rule: no price, no discount, no "free", no promise.
 */
type Lang4 = { en: string; te: string; hi: string; kn: string };

export type Persona = {
  type: SampleType;
  /** The pack folder of C1's `jobs.json` this business type reads its template cards from. */
  pack: string;
  business: string;
  assistant: string;
  /** The business type's short plural noun phrase and a sample item (what the `{item}` of a message becomes). */
  name: { en: string; te: string };
  item: { en: string; te: string };
  /** The "What you sell" style of this business type (C1's `sell_style`). */
  sell: "products" | "services" | "courses" | "properties" | "pricelist";
  /** The festival hint on Today: `season` is the word a template's `season` carries. */
  festival: { season: "diwali" | "wedding_season" | "new_year"; en: string; te: string };
  /** The names of the made-up jobs: the visits job, and the two named jobs of the Jobs page. */
  jobNames: { visits: string; a: string; b: string };
  /** Whole saree phrases of the fixtures and what this business says instead (exact text, longest first). */
  phrases: readonly (readonly [string, string])[];
};

/** The saree shop's words in the fixtures (what `localize` looks for). */
const SAREE = {
  askEn: "You asked about our silk sarees. Which occasion is it for?",
  askTe: "మీరు మా సిల్క్ చీరల గురించి అడిగారు. ఏ సందర్భం కోసం?",
  askHi: "आपने हमारी सिल्क साड़ियों के बारे में पूछा था। किस मौके के लिए चाहिए?",
  askKn: "ನೀವು ನಮ್ಮ ರೇಷ್ಮೆ ಸೀರೆಗಳ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಸಂದರ್ಭಕ್ಕೆ?",
  thanks: "Thank you for asking about our silk sarees. Which occasion is it for?",
};

type Bag = {
  ask: Lang4;
  thanks: string;
  /** "How did you like the Kanchipuram saree you bought last month?" and its plan titles. */
  liked: string;
  likedShort: string;
  likedTitle: string;
  followup: string;
  offerText: string;
  offerTitle: string;
  place: string;
  faqSee: [string, string];
  faqWhere: [string, string];
  faqReturn: [string, string];
  asked: string;
  researcher: string;
  prospect: string;
};

function phrasesOf(b: Bag): [string, string][] {
  return [
    [SAREE.askEn, b.ask.en],
    [SAREE.askTe, b.ask.te],
    [SAREE.askHi, b.ask.hi],
    [SAREE.askKn, b.ask.kn],
    [SAREE.thanks, b.thanks],
    ["How did you like the Kanchipuram saree you bought last month?", b.liked],
    ["How did you like the saree?", b.likedShort],
    ["Ask last month’s silk buyers how they liked it, on WhatsApp", `${b.likedTitle}, on WhatsApp`],
    ["Ask last month’s silk buyers how they liked it", b.likedTitle],
    ["The green Kanchipuram saree is ₹18,500. Shall I keep it for you?", b.followup],
    ["Wedding season offer on silk sarees till 30 November.", b.offerText],
    ["Send the wedding-season offer to customers who said yes", b.offerTitle],
    ["Can I see the sarees before I buy?", b.faqSee[0]],
    ["Yes, come to the store and we will show you everything. You can also get photos on WhatsApp.", b.faqSee[1]],
    ["Where is the shop?", b.faqWhere[0]],
    ["Begum Bazaar, near the main gate. A map link is on our WhatsApp.", b.faqWhere[1]],
    ["Can I return a saree?", b.faqReturn[0]],
    ["Yes, within 7 days with the bill, if it is not worn or washed.", b.faqReturn[1]],
    ["Begum Bazaar", b.place],
    ["the blue Pochampally saree", b.asked],
    ["Find new customers: saree shops and boutiques", b.researcher],
    ["Sri Lakshmi Textiles", b.prospect],
  ];
}

const REAL_ESTATE: Bag = {
  ask: { en: "You asked about our flats. Which area are you looking in?", te: "మీరు మా ఫ్లాట్ల గురించి అడిగారు. ఏ ఏరియాలో చూస్తున్నారు?", hi: "आपने हमारे फ्लैट्स के बारे में पूछा था। आप किस एरिया में देख रहे हैं?", kn: "ನೀವು ನಮ್ಮ ಫ್ಲಾಟ್‌ಗಳ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಏರಿಯಾದಲ್ಲಿ ನೋಡುತ್ತಿದ್ದೀರಿ?" },
  thanks: "Thank you for asking about our flats. Which area are you looking in?",
  liked: "How did you like the 2BHK in Kondapur that you visited last month?",
  likedShort: "How did you like the flat?",
  likedTitle: "Ask last month’s site visitors how they liked it",
  followup: "The 2BHK in Kondapur is still available. Shall I book a site visit for you?",
  offerText: "New flats are ready to visit this month. Tell us a day that suits you.",
  offerTitle: "Tell the customers who said yes about the new flats",
  place: "Kondapur",
  faqSee: ["Can I see the flat before I decide?", "Yes, we will take you for a site visit. You can also get photos on WhatsApp."],
  faqWhere: ["Where is the office?", "Kondapur, near the main road. A map link is on our WhatsApp."],
  faqReturn: ["Can I change my site visit?", "Yes, tell us a day before and we will move it."],
  asked: "the 2BHK in Kondapur",
  researcher: "Find new customers: builders and developers",
  prospect: "Green Valley Builders",
};
const SCHOOL: Bag = {
  ask: { en: "You asked about admissions. Which class is it for?", te: "మీరు అడ్మిషన్ల గురించి అడిగారు. ఏ క్లాస్ కోసం?", hi: "आपने एडमिशन के बारे में पूछा था। किस क्लास के लिए?", kn: "ನೀವು ಅಡ್ಮಿಷನ್ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಕ್ಲಾಸ್‌ಗೆ?" },
  thanks: "Thank you for asking about admissions. Which class is it for?",
  liked: "How did you like the campus visit last month?",
  likedShort: "How did you like the campus?",
  likedTitle: "Ask last month’s campus visitors how they liked it",
  followup: "Class 10 admission is still open. Shall I book a campus visit for you?",
  offerText: "Admissions are open for the new year. Tell us a day to visit the campus.",
  offerTitle: "Tell the parents who said yes that admissions are open",
  place: "Vidya Nagar",
  faqSee: ["Can I see the school before I decide?", "Yes, come for a campus visit and we will show you around. You can also get photos on WhatsApp."],
  faqWhere: ["Where is the school?", "Vidya Nagar, near the main road. A map link is on our WhatsApp."],
  faqReturn: ["Can I change my campus visit?", "Yes, tell us a day before and we will move it."],
  asked: "Class 10 admission",
  researcher: "Find new customers: event and programme partners",
  prospect: "Bright Minds Events",
};
const CARS: Bag = {
  ask: { en: "You asked about our cars. Which model are you looking at?", te: "మీరు మా కార్ల గురించి అడిగారు. ఏ మోడల్ చూస్తున్నారు?", hi: "आपने हमारी कारों के बारे में पूछा था। आप कौन सा मॉडल देख रहे हैं?", kn: "ನೀವು ನಮ್ಮ ಕಾರುಗಳ ಬಗ್ಗೆ ಕೇಳಿದ್ದೀರಿ. ಯಾವ ಮಾಡೆಲ್ ನೋಡುತ್ತಿದ್ದೀರಿ?" },
  thanks: "Thank you for asking about our cars. Which model are you looking at?",
  liked: "How did you like the SUV test drive last month?",
  likedShort: "How did you like the test drive?",
  likedTitle: "Ask last month’s test-drive customers how they liked it",
  followup: "The SUV you drove is still in the showroom. Shall I book another test drive for you?",
  offerText: "New cars have arrived in the showroom. Tell us a day to see them.",
  offerTitle: "Tell the customers who said yes about the new arrivals",
  place: "Kukatpally",
  faqSee: ["Can I try the car before I decide?", "Yes, we can book a test drive for you. You can also get photos on WhatsApp."],
  faqWhere: ["Where is the showroom?", "Kukatpally, near the main road. A map link is on our WhatsApp."],
  faqReturn: ["Can I change my test drive?", "Yes, tell us a day before and we will move it."],
  asked: "the SUV",
  researcher: "Find new customers: fleet buyers",
  prospect: "Sri Ram Travels",
};

const SAREE_PERSONA: Persona = {
  type: "saree",
  pack: "textiles", // pack-id-ok: the sample business reads this pack's jobs.json
  business: MOCK_BUSINESS,
  assistant: MOCK_ASSISTANT,
  name: { en: "saree shops", te: "చీరల షాపులు" },
  item: { en: "Kanchipuram silk sarees", te: "కంచి పట్టు చీరలు" },
  sell: "products",
  festival: { season: "diwali", en: "Diwali", te: "దీపావళి" },
  jobNames: { visits: "Priya", a: "Ravi", b: "Diwali calls" },
  phrases: [],
};

export const PERSONAS: Record<SampleType, Persona> = {
  saree: SAREE_PERSONA,
  realestate: {
    type: "realestate",
    pack: "real_estate", // pack-id-ok: the sample business reads this pack's jobs.json
    business: "Sri Sai Homes",
    assistant: "Meera",
    name: { en: "real estate", te: "రియల్ ఎస్టేట్" },
    item: { en: "the 2BHK in Kondapur", te: "కొండాపూర్ 2BHK" },
    sell: "properties",
    festival: { season: "diwali", en: "Diwali", te: "దీపావళి" },
    jobNames: { visits: "Kiran", a: "Suresh", b: "New flat calls" },
    phrases: phrasesOf(REAL_ESTATE),
  },
  school: {
    type: "school",
    pack: "education", // pack-id-ok: the sample business reads this pack's jobs.json
    business: "Vidya Bharathi School",
    assistant: "Divya",
    name: { en: "schools", te: "స్కూళ్ళు" },
    item: { en: "Class 10 admission", te: "క్లాస్ 10 అడ్మిషన్" },
    sell: "courses",
    festival: { season: "new_year", en: "New academic year", te: "కొత్త విద్యా సంవత్సరం" },
    jobNames: { visits: "Anitha", a: "Rajesh", b: "Admission calls" },
    phrases: phrasesOf(SCHOOL),
  },
  cars: {
    type: "cars",
    pack: "auto_dealer", // pack-id-ok: the sample business reads this pack's jobs.json
    business: "Sai Auto Motors",
    assistant: "Karthik",
    name: { en: "car showrooms", te: "కార్ షోరూమ్‌లు" },
    item: { en: "the SUV", te: "SUV" },
    sell: "products",
    festival: { season: "diwali", en: "Diwali", te: "దీపావళి" },
    jobNames: { visits: "Rohit", a: "Vamsi", b: "Diwali calls" },
    phrases: phrasesOf(CARS),
  },
};

/** The sample business of a type word (null = the saree shop, the demo the mock always was). */
export const personaOf = (type: SampleType | null | undefined): Persona => (type ? PERSONAS[type] : SAREE_PERSONA);

/**
 * The fixtures' words for another business: the shop's name, the assistant's name, the names of the jobs (exact words) and the saree phrases (longest first) are swapped for this business's, deep inside any wire answer. The saree shop is the identity.
 * The job names are swapped only where a whole text is exactly that name (a customer called "Ravi Kumar" stays as it is).
 */
export function localize<T>(wire: T, p: Persona): T {
  if (p.type === "saree") return wire;
  const exact = new Map<string, string>([
    [SAREE_PERSONA.jobNames.visits, p.jobNames.visits],
    [SAREE_PERSONA.jobNames.a, p.jobNames.a],
    [SAREE_PERSONA.jobNames.b, p.jobNames.b],
    [MOCK_ASSISTANT, p.assistant],
  ]);
  const phrases = [...p.phrases].sort((x, y) => y[0].length - x[0].length);
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") {
      const named = exact.get(v);
      if (named !== undefined) return named;
      let s = v;
      for (const [from, to] of phrases) if (s.includes(from)) s = s.split(from).join(to);
      return s.includes(MOCK_BUSINESS) ? s.split(MOCK_BUSINESS).join(p.business) : s;
    }
    if (Array.isArray(v)) return v.map(swap);
    if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return swap(wire) as T;
}
