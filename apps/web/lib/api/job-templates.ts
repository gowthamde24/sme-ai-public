import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, list, nstr, oneOf, optInt, readRows, rec, str, word } from "./shape";
import { TEMPLATE_FINDS, TEMPLATE_GOALS, TEMPLATE_KINDS, TEMPLATE_LANGS, TEMPLATE_NEEDS, TEMPLATE_SEASONS, type Festival, type JobTemplate, type NewJobSheetData, type PackJobs, type TemplateExample, type TemplateSeason, type Texts } from "@/lib/jobs/templates";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * THE ADAPTER of the job templates and the New job sheet (C2, 19 Nov; contract 1.1 lands from C1 on Sun 22 Nov). ONE file: every parser of the wire shape is here, typed to C1's `packages/packs/<pack>/jobs.json`
 * (services/ai-api/app/jobs/packdata.py), so changing the contract means editing this file only. The mock (JOBS=mock) runs the REAL content of five packs (lib/jobs/template-fixtures.ts) through the same parsers
 * (test: lib/api/job-templates.test.ts). Closed words (kind, goal, needs, finds_out, season) are checked; a template that does not fit is logged and LEFT OUT (never drawn half), a pack that does not fit is not drawn at all.
 * SERVER ONLY, with the signed-in person's own token. What the web assumes beyond jobs.json is written in `~/Desktop/stack19-jobs/contracts/jobs-templates-web-needs.md` ("C2:" lines).
 */
const MAX_TEXT = 1200;

/** `{en, te?, hi?, kn?}`: English is always there; a language the web does not know is ignored (a newer API may add one). */
export function parseTexts(v: unknown, what: string): Texts {
  const x = rec(v, what);
  const out: Partial<Record<(typeof TEMPLATE_LANGS)[number], string>> = {};
  for (const lang of TEMPLATE_LANGS) if (x[lang] !== undefined && x[lang] !== null) out[lang] = nstr(x[lang], `${what}.${lang}`, MAX_TEXT);
  if (out.en === undefined) bad(`${what}.en`);
  return out as Texts;
}
const optTexts = (v: unknown, what: string): Texts | null => (v === null || v === undefined ? null : parseTexts(v, what));

/** `sample_audio`: null (no sample recorded yet: the player is not drawn), or a link to play. An id that is not a link is not playable here yet (a question for C1), so it is treated as no sample. */
export function parseSampleAudio(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = str(v, "preview.sample_audio", 300);
  return /^(https:\/\/|\/)[^\s"'<>]+$/.test(s) ? s : null;
}

function parseExample(row: unknown, where: string): TemplateExample {
  const x = rec(row, where);
  return { name: nstr(x.name, `${where}.name`, 120), area: nstr(x.area, `${where}.area`, 80), why: parseTexts(x.why, `${where}.why`), fit: optInt(x.fit, `${where}.fit`, 0, 100) };
}

function closedList<T extends string>(v: unknown, allowed: readonly T[], what: string): T[] {
  const rows = list(v ?? [], what, 20);
  return rows.map((w) => oneOf(w, allowed, what));
}

/** One template of jobs.json: `{id, kind, goal, popular, title, benefit, ask, preview?: {whatsapp?, call?, sample_audio}, examples?, needs, finds_out, season?}`. */
export function parseTemplate(row: unknown): JobTemplate {
  const x = rec(row, "template");
  const where = `template`;
  const preview = x.preview === undefined || x.preview === null ? null : rec(x.preview, `${where}.preview`);
  const examples = x.examples === undefined || x.examples === null ? [] : list(x.examples, `${where}.examples`, 6).map((e, i) => parseExample(e, `${where}.examples[${i}]`));
  const kind = oneOf(x.kind, TEMPLATE_KINDS, `${where}.kind`);
  const t: JobTemplate = {
    id: word(x.id, `${where}.id`, 60),
    kind,
    goal: oneOf(x.goal, TEMPLATE_GOALS, `${where}.goal`),
    popular: bool(x.popular, `${where}.popular`),
    title: parseTexts(x.title, `${where}.title`),
    benefit: parseTexts(x.benefit, `${where}.benefit`),
    ask: parseTexts(x.ask, `${where}.ask`),
    whatsapp: preview ? optTexts(preview.whatsapp, `${where}.preview.whatsapp`) : null,
    call: preview ? optTexts(preview.call, `${where}.preview.call`) : null,
    sampleAudio: preview ? parseSampleAudio(preview.sample_audio) : null,
    examples,
    needs: closedList(x.needs, TEMPLATE_NEEDS, `${where}.needs`),
    findsOut: closedList(x.finds_out, TEMPLATE_FINDS, `${where}.finds_out`),
    season: x.season === undefined || x.season === null ? "none" : oneOf(x.season, TEMPLATE_SEASONS, `${where}.season`),
  };
  // a Lead Finder template shows example prospects and nothing it would say; every other one shows what it says (a bubble or a call): nothing else is drawn
  if (kind === "researcher" ? examples.length === 0 || t.whatsapp || t.call : !t.whatsapp && !t.call) bad(`${where} preview`);
  return t;
}

/** The whole file of a pack (`jobs.json`): `{status, pack, version, templates[]}` (`$comment` is ignored). A template that does not fit is logged and left out. */
export function parsePackJobs(json: unknown): PackJobs {
  const x = rec(json, "pack jobs");
  return {
    pack: word(x.pack, "pack", 40),
    status: word(x.status, "status", 20),
    version: int(x.version, "version", 1, 1000),
    templates: readRows(x.templates, "job templates", parseTemplate, 40),
  };
}

/** The answer of `GET /jobs/templates` (assumed shape, contract 1.1): `{business_type: {pack, name}, sample?: {item}, own: <jobs.json>, others: [{pack, name, jobs: <jobs.json>}]}`. */
export function parseNewJobSheet(json: unknown): NewJobSheetData {
  const x = rec(json, "new job sheet");
  const bt = rec(x.business_type, "business_type");
  const sample = x.sample === undefined || x.sample === null ? null : rec(x.sample, "sample");
  return {
    businessType: { pack: word(bt.pack, "business_type.pack", 40), name: parseTexts(bt.name, "business_type.name") },
    sampleItem: sample ? optTexts(sample.item, "sample.item") : null,
    own: parsePackJobs(x.own),
    others: readRows(
      x.others ?? [],
      "other business types",
      (row) => {
        const o = rec(row, "other");
        return { pack: word(o.pack, "other.pack", 40), name: parseTexts(o.name, "other.name"), jobs: parsePackJobs(o.jobs) };
      },
      20,
    ),
  };
}

/** `GET /jobs/festivals` (assumed): the dated festival calendar of the shop's region, `{items: [{season, name, date}]}`; data per region, never written in the web. An entry with a season the web does not know is left out. */
export function parseFestivals(json: unknown): Festival[] {
  const x = rec(json, "festivals");
  return readRows(
    Array.isArray(json) ? json : x.items,
    "festivals",
    (row) => {
      const f = rec(row, "festival");
      const date = str(f.date, "festival.date", 40);
      if (!/^\d{4}-\d{2}-\d{2}/.test(date) || Number.isNaN(Date.parse(date))) bad("festival.date");
      return { season: oneOf(f.season, TEMPLATE_SEASONS.filter((s) => s !== "none"), "festival.season") as Exclude<TemplateSeason, "none">, name: parseTexts(f.name, "festival.name"), date };
    },
    60,
  );
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};

/** `GET /jobs/templates`: the shop's own templates and the other business types' (the New job sheet's one read). null when the screens are off or the API has none yet (the sheet then draws only the box). JOBS=mock: the real content of five packs. */
export async function readNewJobSheet(token: string, tenantId: string): Promise<NewJobSheetData | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseNewJobSheet((await import("@/lib/jobs/template-fixtures")).wireNewJobSheet());
  try {
    return parseNewJobSheet(await apiRequest(`${base(tenantId)}/jobs/templates`, token));
  } catch {
    return null;
  }
}

/** C1's dated festival calendar is not there yet (contract 1.1, Sun 22 Nov). Until it is, a real workspace gets NO festival suggestion and Today makes no call for it; switching it on is this one word (and the path below, to be confirmed by C1). */
const FESTIVALS_LIVE = false;

/** `GET /jobs/festivals` (assumed path): the festivals ahead for the shop's region, or null (no calendar: the suggestion row is not drawn). JOBS=mock: one made-up festival two weeks ahead, so the row can be seen on any day. */
export async function readFestivals(token: string, tenantId: string, now: Date = new Date()): Promise<Festival[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseFestivals((await import("@/lib/jobs/template-fixtures")).wireFestivals(now));
  if (!FESTIVALS_LIVE) return null;
  try {
    const rows = parseFestivals(await apiRequest(`${base(tenantId)}/jobs/festivals`, token));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}
