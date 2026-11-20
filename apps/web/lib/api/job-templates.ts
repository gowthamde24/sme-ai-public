import { ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, isRec, list, nstr, oneOf, optInt, readRows, rec, str, word } from "./shape";
import { TEMPLATE_FINDS, TEMPLATE_GOALS, TEMPLATE_KINDS, TEMPLATE_LANGS, TEMPLATE_NEEDS, TEMPLATE_SEASONS, type Festival, type JobTemplate, type NewJobSheetData, type PackJobs, type TemplateExample, type TemplateSeason, type Texts, type WhyCode, type WhyParams } from "@/lib/jobs/templates";
import { readSamplePath, SAMPLE_LANGS, type SampleAudio } from "@/lib/jobs/sample-audio";
import { jobsScreens } from "@/lib/screens/flag";

/**
 * THE ADAPTER of the job templates and the New job sheet (C2, 19 Nov; contract 1.1 lands from C1 on Sun 22 Nov). ONE file: every parser of the wire shape is here, typed to C1's job template files (`jobs.json` in each pack folder)
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

/**
 * `sample_audio` (contract 1.1 part 1): `null`, or `{te?, en?, hi?, kn?}` with, per language, EXACTLY the API's path `/v1/job-samples/{pack}/{id}.{lang}.mp3` (lib/jobs/sample-audio.ts). A language whose value is not that exact shape (a scheme, a host, `//`, `\`, another
 * language than its key) is no sample; a language the web does not know is ignored; nothing left = null (no player). What comes out is the path on OUR site (the route app/job-samples streams it), never the API's address.
 */
export function parseSampleAudio(v: unknown): SampleAudio | null {
  if (v === null || v === undefined) return null;
  const x = rec(v, "preview.sample_audio");
  const out: SampleAudio = {};
  for (const lang of SAMPLE_LANGS) {
    const found = readSamplePath(x[lang]);
    if (found && found.lang === lang) out[lang] = found.src;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The params of a `why` code: short closed words or whole numbers (`{category}`, `{km}`, `{rating, count}`); anything else is dropped (never drawn). */
function whyParams(v: unknown): WhyParams {
  const out: Record<string, string | number> = {};
  if (!isRec(v)) return out;
  for (const [k, p] of Object.entries(v)) {
    if (!/^[a-z_]{1,20}$/.test(k)) continue;
    if (typeof p === "number" && Number.isSafeInteger(p)) out[k] = p;
    else if (typeof p === "string" && p.length <= 60) out[k] = p;
  }
  return out;
}

/**
 * One example prospect of a researcher template. The invented ones of jobs.json carry `why` as words (`{en, te?}`) and no `fit`; the REAL ones (contract 1.1 part 1, section 8 item 3: the workspace's best prospects, `examples_real: true` on the template)
 * carry `{name <= 60, area <= 60, fit 0..100, why: {code, params}}`. `fit` is read only for a real example (`strictFit`), so the web never draws a score it was not given for a real shop; the mock fixtures keep their placeholder scores (labelled "Example").
 */
function parseExample(row: unknown, where: string, real: boolean, strictFit: boolean): TemplateExample {
  const x = rec(row, where);
  const why: Texts | WhyCode = isRec(x.why) && typeof x.why.code === "string" ? { code: word(x.why.code, `${where}.why.code`, 40), params: whyParams(x.why.params) } : parseTexts(x.why, `${where}.why`);
  const fit = optInt(x.fit, `${where}.fit`, 0, 100);
  return { name: nstr(x.name, `${where}.name`, 120), area: nstr(x.area, `${where}.area`, 80), why, fit: strictFit && !real ? null : fit };
}

function closedList<T extends string>(v: unknown, allowed: readonly T[], what: string): T[] {
  const rows = list(v ?? [], what, 20);
  return rows.map((w) => oneOf(w, allowed, what));
}

/** One template of jobs.json: `{id, kind, goal, popular, title, benefit, ask, preview?: {whatsapp?, call?, sample_audio}, examples?, needs, finds_out, season?}`. */
export function parseTemplate(row: unknown, strictFit = false): JobTemplate {
  const x = rec(row, "template");
  const where = `template`;
  const preview = x.preview === undefined || x.preview === null ? null : rec(x.preview, `${where}.preview`);
  const examplesReal = x.examples_real === true;
  const examples = x.examples === undefined || x.examples === null ? [] : list(x.examples, `${where}.examples`, 6).map((e, i) => parseExample(e, `${where}.examples[${i}]`, examplesReal, strictFit));
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
    examplesReal,
    sampleItem: optTexts(x.sample_item, `${where}.sample_item`),
    needs: closedList(x.needs, TEMPLATE_NEEDS, `${where}.needs`),
    findsOut: closedList(x.finds_out, TEMPLATE_FINDS, `${where}.finds_out`),
    season: x.season === undefined || x.season === null ? "none" : oneOf(x.season, TEMPLATE_SEASONS, `${where}.season`),
  };
  // a Lead Finder template shows example prospects and nothing it would say; every other one shows what it says (a bubble or a call): nothing else is drawn
  if (kind === "researcher" ? examples.length === 0 || t.whatsapp || t.call : !t.whatsapp && !t.call) bad(`${where} preview`);
  return t;
}

/** The whole file of a pack (`jobs.json`): `{status, pack, version, templates[]}` (`$comment` is ignored). A template that does not fit is logged and left out. */
export function parsePackJobs(json: unknown, strictFit = false): PackJobs {
  const x = rec(json, "pack jobs");
  return {
    pack: word(x.pack, "pack", 40),
    status: word(x.status, "status", 20),
    version: int(x.version, "version", 1, 1000),
    templates: readRows(x.templates, "job templates", (t) => parseTemplate(t, strictFit), 40),
  };
}

/** The answer of `GET /jobs/templates` (assumed shape, contract 1.1): `{business_type: {pack, name}, sample?: {item}, own: <jobs.json>, others: [{pack, name, jobs: <jobs.json>}]}`. */
export function parseNewJobSheet(json: unknown, strictFit = false): NewJobSheetData {
  const x = rec(json, "new job sheet");
  const bt = rec(x.business_type, "business_type");
  const sample = x.sample === undefined || x.sample === null ? null : rec(x.sample, "sample");
  return {
    businessType: { pack: word(bt.pack, "business_type.pack", 40), name: parseTexts(bt.name, "business_type.name") },
    sampleItem: sample ? optTexts(sample.item, "sample.item") : null,
    own: parsePackJobs(x.own, strictFit),
    others: readRows(
      x.others ?? [],
      "other business types",
      (row) => {
        const o = rec(row, "other");
        return { pack: word(o.pack, "other.pack", 40), name: parseTexts(o.name, "other.name"), jobs: parsePackJobs(o.jobs, strictFit) };
      },
      20,
    ),
  };
}

/** `GET /jobs/festivals` (contract 1.1 part 1, section 1 item 7): `{region, items: [{season: diwali|wedding_season|new_year, name {en, te?, hi?, kn?}, date "YYYY-MM-DD", region}]}`; data per region, never written in the web. An entry with a season or a date the web does not know is logged and left out. */
export function parseFestivals(json: unknown): Festival[] {
  const x = Array.isArray(json) ? { items: json } : rec(json, "festivals");
  return readRows(
    x.items,
    "festivals",
    (row) => {
      const f = rec(row, "festival");
      const date = str(f.date, "festival.date", 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) bad("festival.date");
      return { season: oneOf(f.season, TEMPLATE_SEASONS.filter((s) => s !== "none"), "festival.season") as Exclude<TemplateSeason, "none">, name: parseTexts(f.name, "festival.name"), date };
    },
    60,
  );
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("Unexpected workspace id.");
  return `/v1/tenants/${tenantId}`;
};

/** Only an HTTP 404 means "not there yet" (contract 1.1 part 1, section 8 item 10: unbuilt = 404 while JOBS is off or the route does not exist; a real refusal is 403 or 422, never a "not built"): that gives the quiet empty state. Every other refusal is thrown as it is. */
const notThereYet = (error: unknown): boolean => error instanceof ApiRequestError && error.status === 404;

/**
 * `GET /jobs/templates`: the shop's own templates and the other business types' (the New job sheet's one read). null when the screens are off or the API answers 404 (not there yet: the sheet then draws only the box). JOBS=mock: the real content of five packs.
 * Nothing but a 404 is "no ideas": a refusal or a failure is thrown (the sheet shows its sentence), and a rejected session is thrown too, so the caller sends the person to sign in. An answer that is not the contract's shape is logged (like the rows of the other adapters), then null.
 * In real mode an example prospect that is not a real one never carries a score (`strictFit`).
 */
export async function readNewJobSheet(token: string, tenantId: string): Promise<NewJobSheetData | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseNewJobSheet((await import("@/lib/jobs/template-fixtures")).wireNewJobSheet());
  try {
    return parseNewJobSheet(await apiRequest(`${base(tenantId)}/jobs/templates`, token), true);
  } catch (error) {
    if (notThereYet(error)) return null;
    if (error instanceof ApiContractError) {
      console.error("API jobs/templates: the answer is not the contract's shape:", error.message);
      return null;
    }
    throw error;
  }
}

/**
 * `GET /jobs/festivals`: the festivals of the shop's region in the next 60 days, nearest first, one per season (`{region, items}`), or null (a 404, or an empty list: the suggestion row is not drawn). A refusal or a failure is thrown (the caller draws nothing, never a guess).
 * JOBS=mock: one made-up festival two weeks ahead, so the row can be seen on any day.
 */
export async function readFestivals(token: string, tenantId: string, now: Date = new Date()): Promise<Festival[] | null> {
  const mode = jobsScreens();
  if (mode === "off") return null;
  if (mode === "mock") return parseFestivals((await import("@/lib/jobs/template-fixtures")).wireFestivals(now));
  try {
    const rows = parseFestivals(await apiRequest(`${base(tenantId)}/jobs/festivals`, token));
    return rows.length > 0 ? rows : null;
  } catch (error) {
    if (notThereYet(error)) return null;
    if (error instanceof ApiContractError) {
      console.error("API jobs/festivals: the answer is not the contract's shape:", error.message);
      return null;
    }
    throw error;
  }
}
