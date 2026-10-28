import type { AccountSecurity, AuthProviders, PackStatus, PackSummary, Words, WorkspacePack } from "@/lib/packs/types";

import { ApiAuthError, ApiContractError, ApiRequestError, apiPublicRequest, apiRequest } from "./client";

/**
 * Business types, modules and sign-in options (job CL on top of job CK, ADR 0084 part 1), behind ONE adapter. The contract is packages/contracts/packs.ts (generated from the API models):
 *
 *   GET /v1/packs                    no sign-in: the business types a new person may choose (the sign-up cards)
 *   GET /v1/auth/providers           no sign-in: which ways to sign up are on (e-mail always; Google and Facebook only when the server has their keys)
 *   GET /v1/account/security         the session's second-factor level and which groups of actions need one
 *   GET /v1/tenants/{id}/pack        any member: the business type of this workspace (pinned version), its words, units and default modules
 *   GET /v1/tenants/{id}/modules     any member: the modules and which are ON (the answer that counts: default deny, set in the database)
 *
 * The web keeps no copy of the pack files and no list of business types: what it draws comes from these answers. Every field is validated; a malformed answer is an error, never rendered. A server without the
 * pack routes (404/501/503 `packs_unavailable`) gives `null`: the menu is then the one the product always had. Server side only; the workspace reads use the signed-in person's own token.
 */
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a pack response.`);
};

const STATUSES: readonly PackStatus[] = ["draft", "preview", "published"];
const SOURCES = ["signup", "default", "legacy", "operator"] as const;
const CODE = /^[a-z][a-z0-9_]{1,30}$/;
const LABEL_KEY = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/;
const LANGS = ["en", "te", "hi", "kn"] as const;

/** `{ en, te?, hi?, kn? }`: only the languages the product has, every text non-empty and short. English must be there. */
export function parseWords(v: unknown, what: string, max = 240): Words {
  if (!isRecord(v) || typeof v.en !== "string" || v.en.length < 1) return bad(what);
  const out: Record<string, string> = {};
  for (const lang of LANGS) {
    const w = v[lang];
    if (w === undefined) continue;
    if (typeof w !== "string" || w.length < 1 || w.length > max) return bad(what);
    out[lang] = w;
  }
  return out;
}

function parseCode(v: unknown, what: string): string {
  return typeof v === "string" && CODE.test(v) ? v : bad(what);
}

export function parsePackSummary(json: unknown): PackSummary {
  if (!isRecord(json)) return bad("pack");
  if (typeof json.version !== "number" || !Number.isSafeInteger(json.version) || json.version < 1) return bad("version");
  if (!STATUSES.includes(json.status as PackStatus)) return bad("status");
  if (typeof json.validated !== "boolean") return bad("validated");
  return {
    packId: parseCode(json.pack_id, "pack_id"),
    version: json.version,
    status: json.status as PackStatus,
    validated: json.validated,
    names: parseWords(json.names, "names"),
    summary: parseWords(json.summary, "summary"),
    accent: parseCode(json.accent, "accent"),
    owlProp: parseCode(json.owl_prop, "owl_prop"),
  };
}

/** `GET /v1/packs`. An answer with no business type at all is an error (a sign-up page with no cards helps nobody). */
export async function listPacks(): Promise<PackSummary[]> {
  const json = await apiPublicRequest("/v1/packs");
  if (!isRecord(json) || !Array.isArray(json.packs) || json.packs.length < 1 || json.packs.length > 40) return bad("packs");
  return json.packs.map(parsePackSummary);
}

/** `GET /v1/auth/providers`: Google and Facebook are offered only when the server says so. Anything unreadable counts as "off" (e-mail is always there). */
export async function getAuthProviders(): Promise<AuthProviders> {
  try {
    const json = await apiPublicRequest("/v1/auth/providers");
    return isRecord(json) ? { google: json.google === true, facebook: json.facebook === true } : { google: false, facebook: false };
  } catch {
    return { google: false, facebook: false };
  }
}

const AAL = ["aal1", "aal2"] as const;
/** `GET /v1/account/security`. A server without the route (or an unreadable answer) gives null: no notice is drawn, and the actions that need a second factor keep refusing at the database (SM306). */
export async function getAccountSecurity(accessToken: string): Promise<AccountSecurity | null> {
  try {
    const json = await apiRequest("/v1/account/security", accessToken);
    if (!isRecord(json) || !AAL.includes(json.session_level as (typeof AAL)[number]) || !Array.isArray(json.needed_for)) return null;
    return { level: json.session_level as AccountSecurity["level"], neededFor: json.needed_for.filter((x): x is string => typeof x === "string" && CODE.test(x)), ...(typeof json.second_factor_on === "boolean" ? { secondFactorOn: json.second_factor_on } : {}) };
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

function parseLabels(v: unknown): WorkspacePack["labels"] {
  if (!isRecord(v) || !isRecord(v.en)) return bad("labels");
  const out: Record<string, Record<string, string>> = {};
  for (const [lang, words] of Object.entries(v)) {
    if (!(LANGS as readonly string[]).includes(lang)) continue; // a language this build does not have is not something it can draw
    if (!isRecord(words) || Object.keys(words).length > 200) return bad("labels");
    out[lang] = {};
    for (const [key, text] of Object.entries(words)) {
      if (!LABEL_KEY.test(key) || typeof text !== "string" || text.length < 1 || text.length > 80) return bad("label");
      out[lang][key] = text;
    }
  }
  return out;
}

export function parseWorkspacePack(json: unknown): WorkspacePack {
  const summary = parsePackSummary(json);
  const r = json as Rec;
  if (!SOURCES.includes(r.source as (typeof SOURCES)[number])) return bad("source");
  if (!Array.isArray(r.modules) || r.modules.length > 60) return bad("modules");
  if (!Array.isArray(r.units) || r.units.length > 20 || r.units.some((u) => typeof u !== "string")) return bad("units");
  if (r.default_unit !== null && r.default_unit !== undefined && typeof r.default_unit !== "string") return bad("default_unit");
  return {
    ...summary,
    source: r.source as WorkspacePack["source"],
    coreTab: parseCode(r.core_tab, "core_tab"),
    modules: (r.modules as unknown[]).map((m) => parseCode(m, "module")),
    units: r.units as string[],
    defaultUnit: typeof r.default_unit === "string" ? r.default_unit : null,
    hasExampleData: r.has_example_data !== false,
    labels: parseLabels(r.labels),
  };
}

/** `GET /v1/tenants/{id}/modules` -> the modules that are ON. */
export function parseEnabledModules(json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.modules) || json.modules.length > 60) return bad("modules");
  return json.modules.map((m) => {
    if (!isRecord(m) || typeof m.enabled !== "boolean") return bad("module");
    return { code: parseCode(m.module, "module"), enabled: m.enabled };
  }).filter((m) => m.enabled).map((m) => m.code);
}

/** A server that does not have the pack routes: the answer is "no business type", never a crash. */
const noPackRoute = (error: unknown): boolean =>
  error instanceof ApiRequestError && (error.status === 404 || error.status === 501 || (error.status === 503 && error.code === "packs_unavailable"));

/**
 * The business type of a workspace and its modules, two reads together. The modules answer (the one the database enforces) wins over the pack's default list; if only that read fails the pack's own list stands in. A server
 * without the routes gives null. Any other failure is raised (the callers decide how much of a page a failed read may take down).
 */
export async function getWorkspacePack(accessToken: string, tenantId: string): Promise<WorkspacePack | null> {
  const base = `/v1/tenants/${encodeURIComponent(tenantId)}`;
  const [pack, modules] = await Promise.allSettled([apiRequest(`${base}/pack`, accessToken), apiRequest(`${base}/modules`, accessToken)]);
  for (const r of [pack, modules]) if (r.status === "rejected" && r.reason instanceof ApiAuthError) throw r.reason;
  if (pack.status === "rejected") {
    if (noPackRoute(pack.reason)) return null;
    throw pack.reason;
  }
  const parsed = parseWorkspacePack(pack.value);
  if (modules.status === "fulfilled") return { ...parsed, modules: parseEnabledModules(modules.value) };
  return parsed;
}

export function moduleOn(pack: Pick<WorkspacePack, "modules"> | null | undefined, module: string): boolean {
  return !pack || pack.modules.includes(module);
}
