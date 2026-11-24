import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expectNoSentenceForm, sentenceFormsIn } from "../test/helpers/no-sentence-form";

/**
 * Owner, 25 Nov 2026, again 29 Nov: no fill-in-the-blank sentence forms ANYWHERE ("The smallest order is [ ] [pieces]." was shown to him on the Price lists drawer). The sentence machinery is two components, `Sentence`
 * (components/v2/app/jobs/rules/parts.tsx) and `LinkSentence`. A file that draws one must be on this list with a reason, so a NEW sentence form fails the build. An entry whose file no longer draws one also fails
 * (the list can only shrink). The look of a rendered form is checked by `expectNoSentenceForm` (test/helpers/no-sentence-form.ts) in the component tests.
 */
const ROOT = path.resolve(__dirname, "..");
const PLAIN_WHEN_ON = "the plain labelled fields are the production look (SETTINGS_OPEN / FILTERS_OPEN / PHONE_STEPS / JOBS are on); the sentence branch only draws with the flag off";
const TO_FIX = "TO FIX (found 29 Nov by the sweep): still drawn in production under JOBS; converting to plain labelled fields, one page per PR";
const GATED = "drawn only when `sentenceForms()` (JOBS on and SETTINGS_OPEN off); with SETTINGS_OPEN on (production) the labelled form is used (29 Nov)";
const ALLOWED: Record<string, string> = {
  "app/app/tenants/[tenantId]/quote-policy/quote-policy-simple-fields.tsx": PLAIN_WHEN_ON,
  "components/v2/app/agent-settings/AutomationSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/calls/v6/CallsFiltersSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/catalogue/CatalogueFiltersSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/catalogue/ItemFieldsSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/jobs/pages/LinkSentence.tsx": "the component itself (its `plain` prop draws labelled selects)",
  "components/v2/app/leads/LeadsFiltersSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/my-assistant/TalkToYou.tsx": PLAIN_WHEN_ON,
  "components/v2/app/report-v6/PeriodSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/settings/simple/BusinessSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/settings/simple/LanguageSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/settings/simple/NotificationsSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/settings/simple/TeamSimple.tsx": PLAIN_WHEN_ON,
  "components/v2/app/assistant/AssistantSentences.tsx": GATED,
  "components/v2/app/assistant/CallSettingsSimple.tsx": GATED,
  "components/v2/app/billing/v2/LimitLine.tsx": "Billing v2 is not on in production (BILLING_V2); convert before it is",
  "components/v2/app/jobs/rules/PolicySentences.tsx": GATED,
  "components/v2/app/jobs/rules/RulesSimple.tsx": GATED,
  "components/v2/app/settings/AssistantNameCard.tsx": GATED,
  "components/v2/app/settings/DeveloperKeysCard.tsx": GATED,
};

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("no fill-in-the-blank sentence forms", () => {
  const drawers = sources(path.join(ROOT, "components"))
    .concat(sources(path.join(ROOT, "app")))
    .filter((f) => /<(Sentence|LinkSentence)\b/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .sort();
  it("only the listed files draw a sentence component (a new one must not)", () => {
    expect(drawers.filter((f) => !(f in ALLOWED))).toEqual([]);
  });
  it("every listed file still draws one (the list only shrinks)", () => {
    expect(Object.keys(ALLOWED).filter((f) => !drawers.includes(f))).toEqual([]);
  });
});

describe("the rendered-form rule itself", () => {
  const page = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  };
  it("flags a control with words before and after it, and a control followed by a full stop", () => {
    expect(sentenceFormsIn(page('<p>The smallest order is <input> pieces.</p>'))).toHaveLength(1);
    expect(sentenceFormsIn(page("<p><select><option>a</option></select>.</p>"))).toHaveLength(1);
  });
  it("accepts a label above a control, a hint below it, and a label that ends with a colon", () => {
    expect(sentenceFormsIn(page('<label><span>Smallest order</span><input><span>Optional.</span></label>'))).toEqual([]);
    expect(() => expectNoSentenceForm(page("<p>Language: <select><option>a</option></select></p>"))).not.toThrow();
  });
});
