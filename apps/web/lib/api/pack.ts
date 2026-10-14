import { isKnownPack, MODULES, packById, defaultPack } from "@/lib/packs/registry";
import type { FieldDef, FieldEntity, FieldKind, PackDef, PackText, PiiClass, WorkspaceField } from "@/lib/packs/types";

import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";

/**
 * The business type of a workspace (job CL), behind ONE adapter. The contract is the shape ADR 0084 part 1 sketches for `GET /v1/tenants/{id}/pack` (job CK builds it):
 *
 *   { "pack": "<code>", "version": 1, "modules": ["today", ...], "fields": [{ "id", "entity", "code", "kind", "label", "choices"?, "required", "pii_class", "source": "pack"|"owner", "active" }],
 *     "example_data": { "available": bool, "loaded": bool } }
 *
 * Only `pack` is needed; everything else is read when it is there. The WORDS of a pack are not asked of the API: they are the pack files in the repository (packages/packs), looked up by `pack`.
 * `modules` is the API's own answer to "which modules are on" (pack default AND plan AND operator override, default deny): when it is given it wins over the pack file. Until job CK lands, an API that
 * has no such route answers 404 and the workspace is drawn with the DEFAULT pack from its file (`source: "fixture"`): nothing changes for a business that exists today, and nothing is invented.
 * Server side only, with the signed-in person's own token. Every field of the answer is validated; a malformed one is an error, never rendered.
 */
export type ExampleState = "none" | "available" | "loaded";
export type WorkspacePack = {
  def: PackDef;
  version: number;
  modules: readonly string[];
  fields: readonly WorkspaceField[];
  example: ExampleState;
  /** `api`: answered by the server. `fixture`: the API has no such route yet; the default pack's file stands in (nothing can be saved, so the screens that edit fields say so). */
  source: "api" | "fixture";
};

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a pack response.`);
};

const KINDS: readonly FieldKind[] = ["text", "number", "date", "choice", "multi_choice", "yes_no"];
const ENTITIES: readonly FieldEntity[] = ["contact", "catalogue_item"];
const PII: readonly PiiClass[] = ["none", "personal", "child"];
const CODE = /^[a-z][a-z0-9_]{1,31}$/;

/** A label as the API may give it: one string (used in every language) or { en, te?, hi?, kn? }. */
function parseText(v: unknown, what: string): PackText {
  if (typeof v === "string" && v.trim().length >= 1 && v.length <= 160) return { en: v, te: v, hi: v, kn: v };
  if (isRecord(v) && typeof v.en === "string" && v.en.length >= 1 && v.en.length <= 160) {
    const pick = (k: string) => (typeof v[k] === "string" && (v[k] as string).length >= 1 && (v[k] as string).length <= 240 ? (v[k] as string) : (v.en as string));
    return { en: v.en, te: pick("te"), hi: pick("hi"), kn: pick("kn") };
  }
  return bad(what);
}

export function parseField(json: unknown): WorkspaceField {
  if (!isRecord(json)) return bad("field");
  const { id, entity, code, kind, label, required, pii_class: pii, choices, source, active, unit } = json;
  if (!ENTITIES.includes(entity as FieldEntity)) return bad("field entity");
  if (typeof code !== "string" || !CODE.test(code)) return bad("field code");
  if (!KINDS.includes(kind as FieldKind)) return bad("field kind");
  if (!PII.includes(pii as PiiClass)) return bad("field pii_class");
  const isChoice = kind === "choice" || kind === "multi_choice";
  let parsed: FieldDef["choices"];
  if (isChoice) {
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 50) return bad("field choices");
    parsed = choices.map((c) => {
      if (!isRecord(c) || typeof c.code !== "string" || !/^[a-z0-9][a-z0-9_]{0,31}$/.test(c.code)) return bad("choice code");
      return { code: c.code, label: parseText(c.label, "choice label") };
    });
  } else if (choices !== undefined && choices !== null) return bad("field choices");
  if (id !== undefined && id !== null && (typeof id !== "string" || id.length > 64)) return bad("field id");
  if (source !== undefined && source !== "pack" && source !== "owner") return bad("field source");
  if (active !== undefined && typeof active !== "boolean") return bad("field active");
  return {
    id: typeof id === "string" ? id : null,
    entity: entity as FieldEntity,
    code,
    kind: kind as FieldKind,
    label: parseText(label, "field label"),
    ...(typeof unit === "string" && unit.length <= 12 ? { unit } : {}),
    required: required === true,
    pii_class: pii as PiiClass,
    ...(parsed ? { choices: parsed } : {}),
    source: source === "owner" ? "owner" : "pack",
    active: active !== false,
  };
}

export function parseWorkspacePack(json: unknown): WorkspacePack {
  if (!isRecord(json)) return bad("body");
  if (typeof json.pack !== "string" || json.pack.length > 40) return bad("pack");
  // an id this build does not know (a newer API than this web app) is drawn with the default pack's words; the modules and fields the API sends still decide what is on
  const def = isKnownPack(json.pack) ? packById(json.pack) : defaultPack();
  const version = typeof json.version === "number" && Number.isSafeInteger(json.version) && json.version >= 1 ? json.version : def.version;
  let modules: readonly string[] = def.modules;
  if (json.modules !== undefined) {
    if (!Array.isArray(json.modules) || json.modules.length > 60 || json.modules.some((m) => typeof m !== "string")) return bad("modules");
    modules = (json.modules as string[]).filter((m) => MODULES.includes(m)); // an unknown module name is not something this build can draw
  }
  let fields: readonly WorkspaceField[];
  if (json.fields === undefined) fields = fromPack(def);
  else {
    if (!Array.isArray(json.fields) || json.fields.length > 80) return bad("fields");
    fields = json.fields.map(parseField);
  }
  let example: ExampleState = "none";
  if (isRecord(json.example_data)) example = json.example_data.loaded === true ? "loaded" : json.example_data.available === true ? "available" : "none";
  return { def, version, modules, fields, example, source: "api" };
}

/** The pack file's own fields, as a workspace has them before the owner adds any. */
export function fromPack(def: PackDef): WorkspaceField[] {
  return def.fields.map((f) => ({ ...f, id: null, source: "pack" as const, active: true }));
}

/** What stands in until the API has the route: the default pack, from its file. */
export function fixtureWorkspacePack(): WorkspacePack {
  const def = defaultPack();
  return { def, version: def.version, modules: def.modules, fields: fromPack(def), example: "none", source: "fixture" };
}

/** `GET /v1/tenants/{id}/pack`. A 404 means the route does not exist yet (or the workspace is not the caller's, which the page has already settled): the fixture stands in. Any other failure is raised. */
export async function getWorkspacePack(accessToken: string, tenantId: string): Promise<WorkspacePack> {
  try {
    return parseWorkspacePack(await apiRequest(`/v1/tenants/${encodeURIComponent(tenantId)}/pack`, accessToken));
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 501)) return fixtureWorkspacePack();
    throw error;
  }
}

export function moduleOn(pack: Pick<WorkspacePack, "modules">, module: string): boolean {
  return pack.modules.includes(module);
}
