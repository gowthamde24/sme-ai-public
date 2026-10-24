// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LANGS } from "@/i18n/lang";
import { ADDRESSES, LEGAL_TOKENS } from "@/lib/site/business";

import { fillLegal, languagesOf, legalDocument, type DocId } from "./documents";
import { PLACEHOLDER, type Block, type LegalText } from "./types";

const IDS: DocId[] = ["privacy", "terms", "data-deletion"];
const strings = (doc: LegalText): string[] => [doc.title, ...doc.intro, ...doc.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b: Block) => ("p" in b ? [b.p] : "ul" in b ? [...b.ul] : [...b.table.head, ...b.table.rows.flat()]))])];
const tokens = (s: string) => [...s.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();
const shape = (doc: LegalText) => doc.sections.map((s) => ({ id: s.id, blocks: s.blocks.map((b) => ("p" in b ? "p" : "ul" in b ? `ul${b.ul.length}` : `table${b.table.head.length}x${b.table.rows.length}`)) }));

describe("the legal documents in four languages (job DB)", () => {
  it("the Privacy Policy and the data-deletion page exist in all four languages, the Terms in English only", () => {
    expect(languagesOf("privacy")).toEqual(LANGS);
    expect(languagesOf("data-deletion")).toEqual(LANGS);
    expect(languagesOf("terms")).toEqual(["en"]);
    expect(legalDocument("terms", "te").lang).toBe("en"); // falls back, and says which language it really is in
    expect(legalDocument("privacy", "te").lang).toBe("te");
  });
  it.each(IDS)("%s: every language has the same sections, blocks, list lengths and table sizes as English, and the same {tokens} in each string", (id) => {
    const en = legalDocument(id, "en").doc;
    for (const lang of LANGS) {
      const { doc } = legalDocument(id, lang);
      expect(shape(doc), `${id}:${lang}`).toEqual(shape(en));
      const a = strings(en);
      const b = strings(doc);
      expect(b.length, `${id}:${lang}`).toBe(a.length);
      a.forEach((s, i) => expect(tokens(b[i]), `${id}:${lang}:${i}`).toEqual(tokens(s)));
    }
  });
  it.each(IDS)("%s: no missing fact left in any text, and only known {tokens}", (id) => {
    for (const lang of LANGS) {
      for (const s of strings(legalDocument(id, lang).doc)) {
        expect(s.match(PLACEHOLDER), `${id}:${lang}: ${s.slice(0, 60)}`).toBeNull();
        expect(s, `${id}:${lang}`).not.toMatch(/\[(CONFIRM|LEGAL REVIEW|[A-Z ]+)\]/);
        for (const t of tokens(s)) expect(["brand", ...Object.keys(LEGAL_TOKENS)], `${id}:${lang}: {${t}}`).toContain(t);
      }
    }
  });
  it.each(["te", "hi", "kn"] as const)("%s: each text is written in that language's script and keeps the names that stay Latin", (lang) => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
    for (const id of ["privacy", "data-deletion"] as const) {
      const all = strings(legalDocument(id, lang).doc).join("\n");
      expect((all.match(new RegExp(script.source, "g")) ?? []).length, `${id}:${lang}`).toBeGreaterThan(all.length / 4);
    }
    const privacy = strings(legalDocument("privacy", lang).doc).join("\n");
    for (const keep of ["Agent OWL", "sb-<project>-auth-token", "sme_lang", "sme_theme", "sme_consent", "/data-deletion"]) expect(privacy, `${lang}: ${keep}`).toContain(keep);
  });
  it("fillLegal puts the facts of lib/site/business.ts into a text, and leaves an unknown {word} visible", () => {
    expect(fillLegal("Write to {privacy_email} within {grievance_days} days. {brand}. {nope}")).toBe(`Write to ${ADDRESSES.privacy} within 30 days. Stack19. {nope}`);
    expect(fillLegal("{request_days} and {grievance_days} and {withdrawal_hours}")).toBe("7 and 30 and 48");
  });
  it("the English texts carry the owner's facts: Mumbai, the Grievance Officer, 7 and 30 days, the three business types, the children's rules, the trial", () => {
    const privacy = fillLegal(strings(legalDocument("privacy", "en").doc).join("\n"));
    for (const w of ["Mumbai", "Grievance Officer", "Gowtham Reddy Sodanapalli", "privacy@stack19.com", "access, correct or erase your data within 7 days", "any other request or complaint within 30 days", "answer it within 30 days", "We act on a withdrawal of consent within 48 hours", "stop messages, calls and campaigns to you", "do-not-contact option in the app takes effect immediately", "A withdrawal of consent is acted on within 48 hours (section 11)", "Saree and textile wholesale", "Construction materials", "Schools and colleges", "never given to an AI model", "Guardian contact only", "Minimal fields", "nomination", "/data-deletion", "sole proprietorship", "Andhra Pradesh"]) expect(privacy, w).toContain(w);
    const terms = fillLegal(strings(legalDocument("terms", "en").doc).join("\n"));
    for (const w of ["30-day free trial", "add a payment method", "cancel before day 30", "nothing is charged", "prices are not published yet", "Owner, have approved", "No spam", "Consent for messages and calls", "governed by the laws of India", "hello@stack19.com", "support@stack19.com", "billing@stack19.com", "privacy@stack19.com"]) expect(terms.toLowerCase(), w).toContain(w.toLowerCase());
    const deletion = fillLegal(strings(legalDocument("data-deletion", "en").doc).join("\n"));
    for (const w of ["Settings", "Privacy@stack19.com".toLowerCase(), "14 days", "delete your data within 7 days", "any other complaint about your data is answered within 30 days", "within 48 hours", "do not have to delete anything"]) expect(deletion.toLowerCase(), w).toContain(w.toLowerCase());
  });
  it("makes no claim the product cannot keep (compliant, certified, guarantee, a percentage)", async () => {
    const { FORBIDDEN_CLAIMS } = await import("@/i18n/strings/forbidden");
    for (const id of IDS) for (const lang of LANGS) for (const s of strings(legalDocument(id, lang).doc)) for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(s), `${id}:${lang}:${label}: ${s.slice(0, 80)}`).toBe(false);
  });
});
