import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 20 Nov 2026: "Don't mention yearly packages. Monthly is enough." and "That gone too" (the 12-month price lock). No yearly plan, no "2 months free", no yearly price, no "prices locked for 12 months" anywhere in the pricing words: the site (home, /pricing, FAQ) and the in-app Billing (bill.*, bv6.*), every language. No exception.
 */
const BAD = [
  /\byear(ly|s)?\b/i, /\bannual(ly)?\b/i, /\bper annum\b/i, /2 months free|two months free/i, /12 months|twelve months|prices? (are |stay )?locked|price lock|stay the same for/i,
  /12 నెల|12 महीने|12 ತಿಂಗಳ|12 மாத/,
  /సంవత్సర|ఏడాది|वार्षिक|सालाना|साल भर|ವಾರ್ಷಿಕ|ವರ್ಷ|ஆண்டு/,
];
const read = (f: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../i18n/strings", f), "utf8")) as Record<string, Record<string, unknown>>;

function offenders(file: string, keep: (k: string) => boolean) {
  const out: string[] = [];
  for (const [k, v] of Object.entries(read(file))) {
    if (!keep(k) || typeof v !== "object" || v === null) continue;
    for (const [lang, text] of Object.entries(v)) {
      if (typeof text !== "string" || !["en", "te", "hi", "kn", "ta"].includes(lang)) continue;
      const words = text.replaceAll("{year}", ""); // the copyright line's own placeholder is not a plan
      if (BAD.some((re) => re.test(words))) out.push(`${file} ${k} [${lang}]: ${text.slice(0, 60)}`);
    }
  }
  return out;
}

describe("monthly only: no yearly plan words in the pricing strings", () => {
  it("the public site's strings (home, pricing, FAQ) mention no yearly plan", () => {
    expect([...offenders("site.json", () => true), ...offenders("site-drafts.json", () => true)]).toEqual([]);
  });
  it("the in-app Billing strings (bill.*, bv6.*) mention no yearly plan and no price lock", () => {
    expect(offenders("app.json", (k) => /^(bill|bv6|bv)\./.test(k))).toEqual([]);
  });
});
