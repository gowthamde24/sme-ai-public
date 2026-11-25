import { describe, expect, it } from "vitest";
import site from "@/i18n/strings/site.json";
import legal from "@/i18n/strings/legal.json";
import login from "@/i18n/strings/login.json";
import pub from "@/i18n/strings/public.json";
import { SITE_LANGS } from "@/i18n/site-lang";
import { TRANSLATED_LANGS, dictFor, keepHyphenatedWordsWhole } from "@/i18n/strings";
import { FORBIDDEN_CLAIMS as FORBIDDEN } from "@/i18n/strings/forbidden";
import { withTrialDays } from "@/lib/plan/trial-days";

type Entry = { en: string; te: string; hi: string; kn: string; ta?: string; status: Record<string, string>; only?: string[] };
const SETS: Record<string, Record<string, Entry>> = { site, login, legal, pub } as never;
// Tamil (ta) is a language of the public website only: an entry has it where the site has a Tamil text; the others fall back to their English (and the test of the unused keys below says which)
const langsOf = (e: Entry) => e.only ?? [...TRANSLATED_LANGS, ...(e.ta !== undefined ? ["ta"] : [])];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("string store: four languages (and Tamil on the public site)", () => {
  for (const [name, data] of Object.entries(SETS)) {
    const dicts = Object.fromEntries(SITE_LANGS.map((l) => [l, dictFor(data as never, l) as Record<string, string>]));
    const keys = Object.keys(data);
    it(`${name}: the same keys in English, Telugu, Hindi, Kannada and Tamil`, () => {
      for (const lang of SITE_LANGS) expect(Object.keys(dicts[lang]).sort(), `${name}:${lang}`).toEqual([...keys].sort());
    });
    it(`${name}: no empty string, and the same {placeholders} everywhere`, () => {
      for (const lang of SITE_LANGS)
        for (const k of keys) {
          expect(dicts[lang][k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
          expect(placeholders(dicts[lang][k]), `${lang}:${k}`).toEqual(placeholders(dicts.en[k]));
        }
    });
    it(`${name}: the other languages use their own script`, () => {
      const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/, ta: /[஀-௿]/ } as const;
      const exempt = /^(v9\.|langs\.sample\.|theme\.|meta\.description|foot\.copy|legal\.draft\.banner|role\.main\.t$|nav\.whatsapp$|owl\.name\.|ld\.src\.(indiamart|justdial)$|v3\.(day\.\d\.time)$|h2\.plans\.ld$|pp\.(gst|pop|included|setup\.prio)$|h3\.(phone\.(biz|calllog|msg)|how\.f\.(1\.v|[23])|built\.[234]\.t|src\.\d\.[td])$|h2\.out\.2\.t|h2\.finder\.(call|pin\.\d\.what)$|h3\.found\.\d\.[lv]\.\d$)/; // (Latin on purpose: plan names, source names, kinds of school, the phone's own labels) // intentionally Latin or numeric (role.main.t is the product name "Your assistant"; IndiaMART and JustDial are other companies' names)
      // Hindi, Kannada and Tamil: single business words and names that stand alone in Latin on purpose (the owner's style: WhatsApp, plan, OK, enquiry, call, quote in Latin): menu labels, plan terms, units
      const LATIN_LABELS = /^(price\.founding\.t|contact\.(copy|mail|who\.phone)|contact\.addr\.billing|calc\.(unit\.sq_(ft|m)|pieces|pallets|trips)|hm\.(wf\.early|w\.[2-6]\.n)|ld\.deep\.(tag|\w+\.t)|h2\.nav\.(finder|plans|login|early\.short)|h2\.(hear\.on|finder\.skip|foot\.(product|whatsapp))|help\.(4|7)\.t|h3\.ask\.chip\.5|h4\.(eb|nav)\.faq|cookie\.(notice|panel|analytics)\.title)$/;
      for (const lang of ["te", "hi", "kn", "ta"] as const) {
        // a key with no Tamil text shows its English (nothing to check); one with a Tamil text must be in Tamil script unless it is on the list of Latin-on-purpose words
        const missing = keys.filter((k) => !exempt.test(k) && !(lang !== "te" && LATIN_LABELS.test(k)) && (lang !== "ta" || (data[k] as Entry).ta !== undefined) && !script[lang].test(dicts[lang][k]));
        expect(missing, `${name}:${lang}`).toEqual([]);
      }
    });
    it(`${name}: never hard-codes the brand name (it comes from {brand})`, () => {
      for (const lang of SITE_LANGS) for (const k of keys) expect(dicts[lang][k], `${lang}:${k}`).not.toMatch(/sme-?ai/i);
    });
  }
});

describe("honesty: no claims we cannot prove today", () => {
  for (const [name, data] of Object.entries(SETS)) {
    for (const lang of SITE_LANGS) {
      it(`${name} / ${lang}: no forbidden claim`, () => {
        const d = dictFor(data as never, lang) as Record<string, string>;
        // the plans' own numbers (18% GST, the 80% and 100% usage warnings) are the owner's final pricing (19 Nov 2026): the percentage rule does not apply to the plan words
        for (const [k, v] of Object.entries(d)) for (const [re, label] of FORBIDDEN) if (!(label === "a percentage" && /^(pp\.|price\.|h2\.plans\.|meta\.pricing\.|ld\.plans\.|v9\.pricing\.)/.test(k))) expect(re.test(v), `${name}:${lang}:${k} contains ${label}: "${v}"`).toBe(false);
      });
    }
  }
  // the words as a page draws them: {trial_days} is the plans data's number (lib/plan/trial-days.ts)
  const en = Object.fromEntries(Object.entries(dictFor(site, "en") as Record<string, string>).map(([k, v]) => [k, withTrialDays(v)]));
  it("no public English copy says we find or discover leads (owner, 28 Oct: leads come from the website forms, WhatsApp, missed calls, spreadsheets and Meta lead ads; nothing is searched for), and no portal is named as a source", () => {
    // landing v2 (the owner approved the design on 6 Nov 2026): the Lead Finder is a product now and its words (h2.*, h4.*) say it finds new businesses; the older pages' words still never do
    const claims = Object.entries(en).filter(([k]) => !k.startsWith("h2.") && !k.startsWith("pp.") && !k.startsWith("h3.radar.") && !k.startsWith("h4.") && !k.startsWith("v9.")).filter(([, v]) => /\bfinds? (your |new |more )?(leads|customers|buyers)\b|\bfinding (new )?(leads|customers)\b|lead finder|lead finding|leads we find|new customers found|find leads|discover(s|ing)? (new )?leads/i.test(v));
    expect(claims.map(([k]) => k)).toEqual([]);
    expect(Object.entries(en).filter(([k, v]) => !k.startsWith("ld.src.") && /99acres|MagicBricks/.test(v))).toEqual([]);
  });
  it("no public page names a trial length or a price (owner, 28 Oct: pricing is undecided): no '14 days', no 'free trial', no 'Most popular', no rupee amount, no assistant name", () => {
    // landing v2 (owner, 6 Nov 2026): the home page's trial button names the trial's length ({trial_days}), and its examples name a customer's own budget (not a price of ours); "Price at launch" stays
    const hits = Object.entries(en).filter(([k, v]) => !/^(ld\.src\.|legal\.|h2\.|pp\.|price\.faq\.|meta\.pricing\.|v9\.)/.test(k) && /\b\d+[- ]days?\b.*\btrial|\btrial\b|free trial|most popular|₹\s?\d|\bRs\.? ?\d/i.test(v)).map(([k]) => k);
    expect(hits).toEqual([]);
    // the trial's length and GST wait for the lawyer's review and the GST registration (owner, 6 Nov 2026): only the h2.later.* words (shown with SITE_TRIAL_COPY=1) may name them
    expect(Object.entries(en).filter(([k, v]) => k.startsWith("h2.") && !k.startsWith("h2.later.") && /\{trial_days\}|\b\d+[- ]days?\b|GST included|incl\w* GST|plus GST|card or UPI/i.test(v)).map(([k]) => k)).toEqual([]);
    // the public site names no assistant: a literal "your assistant" (the words {assistant} becomes) is fine in the plans and flow rows of 19 Nov 2026; a name is not
    expect(Object.entries(en).filter(([k, v]) => (/\bTara\b/.test(v) || (/\byour assistant\b/.test(v) && !/^(v9\.[\w.]+|cta\.sub|price\.(trial\.d|faq\.5\.a)|ld\.(s\.1\.d|plans\.wf\.d|pack\.\w+\.t)|pp\.setup\.self)$/.test(k))))).toEqual([]);
  });
  it("the English home copy says what it must: the owner approves money and campaigns, and AI calls in the hero example are early access (and nothing else is)", () => {
    expect(en["hm.ctl.d"]).toMatch(/money reminders and discounts wait for your approval/);
    // owner, 20:52 on 27 Oct: the headline makes no promise of a number; the fast first call is the Lead Desk row's explained "about a minute", by source
    expect(en["hero.h1"]).toBe("Every enquiry answered. Every customer followed up."); // reworded 19 Nov 2026 (no product name)
    expect(en["hero.note"]).toBe("Money reminders and discounts wait for your approval."); // owner, 28 Oct: no trial length or price on any screen until pricing is set
    expect(en["hm.pl.sub"]).toBe("Prices are announced at launch.");
    // "early access" is said only where it is true: the AI calls (job DM); nothing says sign-up is by invitation
    const EARLY_OK = new Set(["price.early" /* the free-early-access pricing note (owner's launch scope, 18 Nov) */, "demo.cta", "demo.note", "soon.title", "demo.title", "demo.submit", "demo.notice", "demo.consent", "h2.join.once", /* the waitlist form is "Join early access" (owner, 11 Nov 2026) */ "hm.demo.note", "hm.wf.early", "h2.nav.early", "h2.nav.early.short", "h3.cta", "h3.menu.cta", "h3.ask.note",  "h3.plans.free", "h4.pl.line", /* the home page of 19 Nov 2026: early access is free until paid plans start */ "h2.hero.sub", "h2.hero.sub.phone", "h2.plans.f.2", "h2.finder.sub", "h2.faq.3.a"]); // landing v2 (owner, 6 Nov 2026): "Get early access" is the home page's form, and the Lead Finder is in early access (it finds no real businesses yet)
    for (const k of Object.keys(en)) {
      expect(en[k], k).not.toMatch(/invitation only|by invitation/i);
      if (!EARLY_OK.has(k) && !/^(v9\.|price\.|pp\.|h2\.plans\.|meta\.pricing\.|ld\.plans\.)/.test(k)) expect(en[k], k).not.toMatch(/early access/i);
    }
    expect(en["hero.cta"]).toBe("Get started");
    expect(en["cta.start"]).toBe("Get started");
    for (const k of Object.keys(en).filter((x) => !/^(price\.faq\.|pp\.)/.test(x))) expect(en[k], k).not.toMatch(/30-day|30 days|day 30/); // (the paid plans hold a released number for 30 days: price.faq.6, 19 Nov 2026)
  });
  it("never says the trial needs no card, and holds no price in any website or sign-in string (job CX: the owner decides prices after usage tests)", () => {
    for (const set of [site, login] as unknown as Record<string, Entry>[])
      for (const lang of SITE_LANGS) {
        const d = dictFor(set as never, lang) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) {
          // landing v2's examples (h2.*: a customer's budget, the visitor's own estimate) may show rupees; none is a price of ours
          expect(v, `${lang}:${k}`).not.toMatch(/^(v9\.|h2\.|h3\.|pp\.|price\.faq\.|meta\.pricing\.)/.test(k) ? /\bno card\b|without a card|no credit card|Nothing is charged/i : /\bno card\b|without a card|no credit card|Nothing is charged|₹/i);
          expect(v, `${lang}:${k}`).not.toMatch(/Sme-?AI|working name/i);
        }
      }
  });
  it("the pricing copy: early access is free, the paid plans start in February 2027, and every paid-plan fact says so (owner's final numbers, 19 Nov 2026); the old 'Pricing announced soon' rows hold no amount", () => {
    expect(en["price.sub"]).toMatch(/Early access is free\. Paid plans start in February 2027/);
    expect(en["price.billing"]).toMatch(/Paid plans start in February 2027/);
    expect(en["price.faq.3.a"]).toMatch(/With paid plans \(from February 2027\)/);
    expect(en["price.soon"]).toBe("Pricing announced soon");
    for (const k of Object.keys(en).filter((x) => /^(price\.(soon|trial|founding|dfy)|home\.price\.)/.test(x))) expect(en[k], k).not.toMatch(/₹|\d{3}|\bGST\b/);
    for (const k of Object.keys(en).filter((x) => /^(pp\.|price\.faq\.)/.test(x))) expect(en[k], k).not.toMatch(/unlimited|most popular|guarantee/i);
  });
  it("the Lead Desk copy says the call happens in calling hours (no number of minutes), says whom we call, names no price or number it cannot back, and puts no third-party logo or praise in words", () => {
    expect(en["ld.aim"]).toBe("{assistant} calls your leads in your calling hours.");
    expect(en["ld.rules"]).toBe("We call only people who gave their number to the business. We follow calling hours and do-not-disturb rules.");
    expect(en["ld.plans.wf.d"]).toBe("Everything in your assistant, plus your industry pack and research."); // 19 Nov 2026: the product name is gone from the public words
    expect(en["ld.pack.education.note"]).toMatch(/never talks about fees, marks or dues/);
    const ld = Object.keys(en).filter((k) => k.startsWith("ld."));
    expect(ld.length).toBeGreaterThan(60);
    for (const k of ld) {
      expect(en[k], k).not.toMatch(/₹|\bGST\b|most popular|best value|guarantee|data stored|stored in india|early access|\d\s?%/i);
      expect(en[k], k).not.toMatch(/\b(logo|trusted|testimonial)\b/i);
    }
    // the only digits in the Lead Desk words: the 2-minute aim, the plan names' allowances are NOT here (they come from the plans data), and the numbers of the step lists
    for (const k of ld.filter((x) => !/^ld\.(s|pack\.\w+)\.\d/.test(x))) if (/\d/.test(en[k])) expect(k, `${k}: ${en[k]}`).toMatch(/^ld\.(aim|rules|plans\.\w+\.t)$|^hero\.h1$/);
  });
  it("the security copy claims only what exists and says what does not", () => {
    expect(en["sec.rights.d"]).toMatch(/not had an independent review/);
    expect(en["sec.where.d"]).toMatch(/not hosted for real customers yet/);
    expect(en["sec.kids.d"]).toMatch(/waits for a legal review/);
    for (const k of Object.keys(en).filter((x) => x.startsWith("sec."))) expect(en[k], k).not.toMatch(/compliant|certified|audited|encrypted/i);
  });
});

describe("string store: status", () => {
  it("every string has a draft or reviewed status for each language it exists in", () => {
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        for (const l of langsOf(e)) expect(["draft", "reviewed"], `${set}.${key}:${l}`).toContain(e.status[l]);
        for (const l of Object.keys(e.status)) expect(langsOf(e), `${set}.${key} has a status for ${l}`).toContain(l);
      }
    }
  });
  it("dictFor builds one flat dictionary per language", () => {
    const te = dictFor(login, "te");
    expect(Object.keys(te)).toEqual(Object.keys(login));
    expect(te["signin.title"]).toBe(keepHyphenatedWordsWhole(login["signin.title"].te));
  });
});

// The register brief (i18n/STYLE.md) bans bookish words. A guard, not the whole style.
const BANNED: Record<"te" | "hi" | "kn" | "ta", string[]> = {
  te: ["దయచేసి", "తెలియజేయ", "ఆమోదించ", "సమాధానం", "నమోదు", "పరిశోధ", "సందేశం", "చెల్లింపు", "వినియోగదారు", "ధృవీకరించ", "అభ్యర్థన", "ఏజెంట్"],
  hi: ["कृपया", "निर्णय", "संदेश", "भुगतान", "अग्रिम", "उपभोक्ता", "प्रतीक्षा", "पंजीकरण", "सत्यापित", "अनुरोध", "उपयोगकर्ता", "प्रदर्शित", "अनुमोदित", "एजेंट"],
  kn: ["ದಯವಿಟ್ಟು", "ನಿರ್ಧಾರ", "ಸಂದೇಶ", "ಅನುಮೋದ", "ಪಾವತಿ", "ದಾಖಲಿಸ", "ದಾಖಲಾಗ", "ಪರಿಶೀಲ", "ಬಳಕೆದಾರ", "ಧೃಢೀಕರ", "ಏಜೆಂಟ್", "ಮನವಿ"],
  // Tamil: the business words (customer, enquiry, call, plan, ...) are written in Latin like the other languages, and no bookish or official word is used where a spoken one is
  ta: ["தயவுசெய்து", "வாடிக்கையாளர்", "விசாரணை", "அழைப்பு", "வணிகம்", "பயனர்", "கைபேசி", "அலைபேசி", "கட்டணம் செலுத்த", "தயவு செய்து"],
};
describe("string store: everyday register", () => {
  it("none of the Telugu, Hindi, Kannada or Tamil strings uses a bookish word from the style brief", () => {
    const hits: string[] = [];
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        for (const l of langsOf(e) as ("te" | "hi" | "kn" | "ta")[]) {
          // the Telugu stand-up of landing v2 is C1's recorded script word for word (the captions follow the recording); it waits for its native review, which may change the recording and these words together
          if (set === "site" && /^h2\.meet\.\d\.text$/.test(key) && l === "te") continue;
          for (const w of BANNED[l]) if ((e[l] ?? "").includes(w)) hits.push(`${set}.${key}:${l} has "${w}"`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
  it("keeps sentences short: no string is a wall of text", () => {
    const long: string[] = [];
    for (const [set, data] of Object.entries(SETS)) {
      for (const [key, e] of Object.entries(data)) {
        if (/^meta\.description$/.test(key)) continue;
        for (const l of langsOf(e) as ("te" | "hi" | "kn" | "ta")[]) {
          const words = (e[l] ?? "").split(/\s+/).length;
          if (words > 45) long.push(`${set}.${key}:${l} has ${words} words`);
        }
      }
    }
    expect(long).toEqual([]);
  });
});

describe("string store: no bad hyphen wrap", () => {
  it("puts an invisible word joiner after a hyphen between two letters, in te / hi / kn / ta only", () => {
    expect(keepHyphenatedWordsWhole("फ़ॉलो-अप")).toBe("फ़ॉलो-⁠अप");
    expect(keepHyphenatedWordsWhole("ఫాలో-అప్ డ్రాఫ్ట్")).toBe("ఫాలో-⁠అప్ డ్రాఫ్ట్");
    expect(keepHyphenatedWordsWhole("GST 5% - ok")).toBe("GST 5% - ok");
    expect(dictFor(site, "en")["nav.how"]).toBe(site["nav.how"].en);
  });
  it("inserts only U+2060 (word joiner), never ZWJ or ZWNJ: without it every built string equals the stored text", () => {
    for (const [set, data] of Object.entries({ site, login })) {
      for (const l of ["te", "hi", "kn", "ta"] as const) {
        const d = dictFor(data as never, l) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) {
          const raw = (data as unknown as Record<string, Record<string, string>>)[k][l] ?? (data as unknown as Record<string, Record<string, string>>)[k].en; // (no Tamil text: the English)
          expect(v.replaceAll("⁠", ""), `${set}.${k}:${l}`).toBe(raw);
          for (const c of [...v].filter((ch) => !raw.includes(ch))) expect(c, `${set}.${k}:${l}`).toBe("⁠");
        }
      }
    }
  });
  it("leaves no breakable hyphen between letters in any built dictionary", () => {
    const bad: string[] = [];
    for (const [set, data] of Object.entries({ site, login })) {
      for (const l of ["te", "hi", "kn", "ta"] as const) {
        const d = dictFor(data as never, l) as Record<string, string>;
        for (const [k, v] of Object.entries(d)) if (/[\p{L}\p{M}]-[\p{L}\p{M}]/u.test(v)) bad.push(`${set}.${k}:${l}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
