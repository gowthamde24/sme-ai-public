import { bad, int, list, rec, str, word } from "@/lib/api/shape";
import mockTemplates from "./mock-templates.json";
import type { PackSummary, Words } from "@/lib/packs/types";

/**
 * The nine "any business with leads" types of Lead Desk (night 4, part A1; contract-leads-pack.md): ordinary business types of the API (`GET /v1/packs` lists them with the three deep ones) that have a LEAD TEMPLATE (a goal, questions,
 * objections, follow-ups). The sign-up groups them under ONE card, "Any business with leads", and then shows the picker of these. A template is DATA of the API (`GET /v1/lead-templates`, public): the web keeps no list of business types in code
 * except the made-up nine of the TEST screens (LEADS_SCREENS=mock). Pure parsing and the test data: no request, no cookie.
 */
export type LeadTemplate = {
  packId: string;
  version: number;
  names: Words;
  summary: Words;
  goalCode: string;
  goalLabel: Words;
  questionCount: number;
  accent: string;
  owlProp: string;
  validated: boolean;
};

const words = (v: unknown, what: string): Words => {
  const r = rec(v, what);
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(r)) if (/^[a-z]{2}$/.test(k)) out[k] = str(x, what, 400);
  if (!out.en) bad(what);
  return out;
};

export function parseTemplates(json: unknown): LeadTemplate[] {
  const x = rec(json, "lead templates");
  return list(x.templates, "templates", 40).map((row) => {
    const r = rec(row, "template");
    const goal = rec(r.goal, "goal");
    return {
      packId: word(r.pack_id, "pack_id", 40),
      version: int(r.version, "version", 1, 10_000),
      names: words(r.names, "names"),
      summary: words(r.summary, "summary"),
      goalCode: word(goal.code, "goal.code", 40),
      goalLabel: words(goal.label, "goal.label"),
      questionCount: int(r.question_count, "question_count", 0, 100),
      accent: word(r.accent, "accent", 40),
      owlProp: word(r.owl_prop, "owl_prop", 40),
      validated: r.validated === true,
    };
  });
}

/** A template as the sign-up card list knows a business type (status `preview`: "Not validated by a real owner yet"). */
export const toPackSummary = (t: LeadTemplate): PackSummary => ({ packId: t.packId, version: t.version, status: "preview", validated: t.validated, names: t.names, summary: t.summary, accent: t.accent, owlProp: t.owlProp });

/** The id of the ONE card that stands for the nine on the first sign-up step (`/signup?type=leads` shows the picker). Not a business type: it is never sent to the API. */
export const LEADS_CARD_ID = "leads";

/** The made-up nine of the test screens (LEADS_SCREENS=mock), in the API's order (by pack id): DATA in mock-templates.json (English, Telugu, Hindi and Kannada drafts), because no business type is named in code. */
export const MOCK_TEMPLATES: readonly LeadTemplate[] = mockTemplates;
