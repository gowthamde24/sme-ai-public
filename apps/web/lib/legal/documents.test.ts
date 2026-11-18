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
  it("the data-deletion page exists in all four languages; the Privacy notice and the Terms are English only (owner, 18 Nov)", () => {
    expect(languagesOf("privacy")).toEqual(["en"]); // English only until the owner approves a translation (18 Nov)
    expect(languagesOf("data-deletion")).toEqual(LANGS);
    expect(languagesOf("terms")).toEqual(["en"]);
    expect(legalDocument("terms", "te").lang).toBe("en"); // falls back, and says which language it really is in
    expect(legalDocument("privacy", "te").lang).toBe("en"); // English only until the owner approves a translation (18 Nov)
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
        for (const t of tokens(s)) expect(["brand", "trial_days", ...Object.keys(LEGAL_TOKENS)], `${id}:${lang}: {${t}}`).toContain(t);
      }
    }
  });
  it.each(["te", "hi", "kn"] as const)("%s: the data-deletion text is written in that language's script", (lang) => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang];
    const all = strings(legalDocument("data-deletion", lang).doc).join("\n");
    expect((all.match(new RegExp(script.source, "g")) ?? []).length, `data-deletion:${lang}`).toBeGreaterThan(all.length / 4);
  });
  it.each(IDS)("%s: names no assistant: it says 'our AI assistant', in every language (job DO)", (id) => {
    for (const lang of LANGS) expect(JSON.stringify(legalDocument(id, lang).doc), `${id}:${lang}`).not.toMatch(/\{assistant\}|your assistant|Agent OWL/);
  });
  it("fillLegal puts the facts of lib/site/business.ts into a text, and leaves an unknown {word} visible", () => {
    expect(fillLegal("Write to {privacy_email} within {grievance_days} days. {brand}. {nope}")).toBe(`Write to ${ADDRESSES.privacy} within 30 days. Stack19. {nope}`);
    expect(fillLegal("{request_days} and {grievance_days} and {withdrawal_hours}")).toBe("7 and 30 and 48");
  });
  it("the English texts carry the facts C1 gave (18 Nov): where it is stored, what is not kept, who to write to, how fast we answer; the terms carry the free-early-access numbers", () => {
    const privacy = fillLegal(strings(legalDocument("privacy", "en").doc).join("\n"));
    for (const w of ["Privacy notice", "SODANAPALLI GOWTHAM REDDY", "privacy@stack19.com", "security@stack19.com", "Mumbai", "Calls are not recorded", "not stored by Stack19; we keep only the application status", "395 days", "12 months", "say STOP", "honoured at once and for good", "within 7 days", "within 30 days", "within 48 hours", "Settings, then Privacy and data", "/data-deletion", "The assistant in Stack19 is an AI", "always the list in use", "Call businesses found by the Lead Finder"]) expect(privacy.toLowerCase(), w).toContain(w.toLowerCase());
    const terms = fillLegal(strings(legalDocument("terms", "en").doc).join("\n"));
    for (const w of ["Free Early Access", "60 minutes of AI calls", "300 WhatsApp messages", "One business phone number", "no Lead Finder prospects", "calls are not recorded", "We do not sell it", "Mumbai", "We do not store the file", "hello@stack19.com", "support@stack19.com", "privacy@stack19.com", "Indian law applies"]) expect(terms.toLowerCase(), w).toContain(w.toLowerCase());
    const deletion = fillLegal(strings(legalDocument("data-deletion", "en").doc).join("\n"));
    for (const w of ["Settings", "Privacy@stack19.com".toLowerCase(), "after 7 days", "delete your data within 7 days", "any other complaint about your data is answered within 30 days", "within 48 hours", "do not have to delete anything"]) expect(deletion.toLowerCase(), w).toContain(w.toLowerCase());
  });
  it("makes no claim the product cannot keep (compliant, certified, guarantee, a percentage)", async () => {
    const { FORBIDDEN_CLAIMS } = await import("@/i18n/strings/forbidden");
    for (const id of IDS) for (const lang of LANGS) for (const s of strings(legalDocument(id, lang).doc)) for (const [re, label] of FORBIDDEN_CLAIMS) expect(re.test(s), `${id}:${lang}:${label}: ${s.slice(0, 80)}`).toBe(false);
  });
});
