import { ApiContractError, apiRequest, apiUploadRequest } from "./client";

/**
 * The business's own profile (job DT, ADR 0115): `GET/PATCH /v1/tenants/{id}/workspace/profile`, `POST /workspace/logo` and `/workspace/logo/remove`. Any member reads; the Owner changes the name, the type, the city, the phone and the languages (no
 * second factor asked); the Owner and an Admin change the logo. `type` is a business type of `GET /v1/packs` or "other" (with `type_label`, what it is in the Owner's words). Server side only, with the signed-in person's own token.
 * A change of type can be refused with 409 `type_change_refused` and a `reason` (the caller shows it). `name_used_in` is the API's closed list of where the name shows.
 */
export const NAME_USED_IN = ["assistant_greeting", "voice_preview", "call_opening", "whatsapp_opening", "menu_header"] as const;
export type NameUsedIn = (typeof NAME_USED_IN)[number];

export interface WorkspaceProfile {
  name: string;
  type: string;
  typeName: string | null;
  typeLabel: string | null;
  city: string | null;
  phone: string | null;
  languages: string[];
  /** A signed address that expires in ten minutes; null when there is no logo. */
  logoUrl: string | null;
  nameUsedIn: NameUsedIn[];
}

const text = (v: unknown, what: string, max: number): string => (typeof v === "string" && v.length >= 1 && v.length <= max ? v : bad(what));
const maybe = (v: unknown, what: string, max: number): string | null => (v === null || v === undefined ? null : typeof v === "string" && v.length <= max ? (v.trim() === "" ? null : v) : bad(what));
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a workspace profile response.`);
}

export function parseWorkspaceProfile(json: unknown): WorkspaceProfile {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return bad("body");
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.languages) || !Array.isArray(r.name_used_in)) return bad("lists");
  return {
    name: text(r.name, "name", 200),
    type: text(r.type, "type", 60),
    typeName: maybe(r.type_name, "type_name", 200),
    typeLabel: maybe(r.type_label, "type_label", 100),
    city: maybe(r.city, "city", 200),
    phone: maybe(r.phone, "phone", 40),
    languages: r.languages.filter((l): l is string => typeof l === "string"),
    logoUrl: maybe(r.logo_url, "logo_url", 4000),
    nameUsedIn: r.name_used_in.filter((u): u is NameUsedIn => (NAME_USED_IN as readonly unknown[]).includes(u)),
  };
}

const path = (tenantId: string, tail: string) => `/v1/tenants/${encodeURIComponent(tenantId)}/workspace/${tail}`;

export async function getWorkspaceProfile(accessToken: string, tenantId: string): Promise<WorkspaceProfile> {
  return parseWorkspaceProfile(await apiRequest(path(tenantId, "profile"), accessToken));
}

/** The fields the Owner may change; `city` and `phone` may be null (that clears them). What is left out is kept. */
export type WorkspacePatch = { name?: string; type?: string; type_label?: string; city?: string | null; phone?: string | null; languages?: string[] };

export async function patchWorkspaceProfile(accessToken: string, tenantId: string, patch: WorkspacePatch): Promise<WorkspaceProfile> {
  return parseWorkspaceProfile(await apiRequest(path(tenantId, "profile"), accessToken, { method: "PATCH", body: JSON.stringify(patch) }));
}

/** The picture itself is the body (JPG, PNG or WebP, at most 5 MB); the API checks the bytes again. */
export async function uploadLogo(accessToken: string, tenantId: string, body: ArrayBuffer, contentType: string): Promise<WorkspaceProfile> {
  return parseWorkspaceProfile(await apiUploadRequest(path(tenantId, "logo"), accessToken, body, contentType));
}

export async function removeLogo(accessToken: string, tenantId: string): Promise<WorkspaceProfile> {
  return parseWorkspaceProfile(await apiRequest(path(tenantId, "logo/remove"), accessToken, { method: "POST", body: JSON.stringify({}) }));
}
