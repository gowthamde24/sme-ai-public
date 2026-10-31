import { ApiContractError, apiRequest, apiUploadRequest } from "./client";

/**
 * A member's own profile (job DT, ADR 0115): `GET/PATCH /v1/tenants/{id}/me/profile` (name and language), `POST /me/picture` (the body is the image) and `/me/picture/remove`, and `GET /people` (the names and pictures of the workspace's
 * members, for the menu footer, the team list and the hand-off messages). `picture` says whose photo shows: the member's own, the Google one, or none (the screen then draws the first letters). Any member, about themselves. Server side only.
 */
export type PictureKind = "own" | "google" | "none";
export interface MyProfile {
  displayName: string | null;
  language: string | null;
  picture: PictureKind;
  pictureUrl: string | null;
  /** "How should I address you?" (C1, 30 Oct): a word or two, at most 30 characters; "" = not set. `undefined` = this API does not have the field yet (the screen then does not draw it and never sends it). */
  addressAs?: string;
  /** The language of the assistant chat the person chose (C1, 31 Oct): "auto" or a language; null = never chosen (follow the app language). `undefined` = this API does not have the field yet. */
  preferredChatLanguage?: string | null;
}
export interface Person {
  userId: string;
  displayName: string | null;
  picture: PictureKind;
  pictureUrl: string | null;
}

function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a profile response.`);
}
const KINDS: readonly unknown[] = ["own", "google", "none"];
export const CHAT_LANGUAGES: readonly string[] = ["auto", "te", "en", "hi", "kn", "ta", "ml"];
const maybe = (v: unknown, what: string, max: number): string | null => (v === null || v === undefined ? null : typeof v === "string" && v.length <= max ? v : bad(what));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMyProfile(json: unknown): MyProfile {
  if (!isRecord(json) || !KINDS.includes(json.picture)) return bad("body");
  return { displayName: maybe(json.display_name, "display_name", 200), language: maybe(json.language, "language", 8), picture: json.picture as PictureKind, pictureUrl: maybe(json.picture_url, "picture_url", 4000), ...("preferred_chat_language" in json ? { preferredChatLanguage: typeof json.preferred_chat_language === "string" && CHAT_LANGUAGES.includes(json.preferred_chat_language) ? json.preferred_chat_language : null } : {}), ...("address_as" in json ? { addressAs: maybe(json.address_as, "address_as", 30) ?? "" } : {}) };
}

export function parsePeople(json: unknown): Person[] {
  if (!isRecord(json) || !Array.isArray(json.people)) return bad("people");
  return json.people.map((p) => {
    if (!isRecord(p) || typeof p.user_id !== "string" || !KINDS.includes(p.picture)) return bad("person");
    return { userId: p.user_id, displayName: maybe(p.display_name, "display_name", 200), picture: p.picture as PictureKind, pictureUrl: maybe(p.picture_url, "picture_url", 4000) };
  });
}

const path = (tenantId: string, tail: string) => `/v1/tenants/${encodeURIComponent(tenantId)}/${tail}`;

export async function getMyProfile(accessToken: string, tenantId: string): Promise<MyProfile> {
  return parseMyProfile(await apiRequest(path(tenantId, "me/profile"), accessToken));
}

export async function patchMyProfile(accessToken: string, tenantId: string, patch: { display_name?: string; language?: string; address_as?: string; preferred_chat_language?: string }): Promise<MyProfile> {
  return parseMyProfile(await apiRequest(path(tenantId, "me/profile"), accessToken, { method: "PATCH", body: JSON.stringify(patch) }));
}

/** The picture itself is the body (JPG, PNG or WebP, at most 5 MB); the API checks the bytes again and makes the sizes. */
export async function uploadMyPicture(accessToken: string, tenantId: string, body: ArrayBuffer, contentType: string): Promise<MyProfile> {
  return parseMyProfile(await apiUploadRequest(path(tenantId, "me/picture"), accessToken, body, contentType));
}

export async function removeMyPicture(accessToken: string, tenantId: string): Promise<MyProfile> {
  return parseMyProfile(await apiRequest(path(tenantId, "me/picture/remove"), accessToken, { method: "POST", body: JSON.stringify({}) }));
}

export async function getPeople(accessToken: string, tenantId: string): Promise<Person[]> {
  return parsePeople(await apiRequest(path(tenantId, "people"), accessToken));
}
