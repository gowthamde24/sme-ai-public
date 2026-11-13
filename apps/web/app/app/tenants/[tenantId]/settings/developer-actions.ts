"use server";

import { revalidatePath } from "next/cache";

import type { Failed, Reply } from "@/components/v2/app/cc/kit";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { KEY_SCOPES, type DevKey, type KeyScope } from "@/lib/api/developer";
import { failureOf } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { makeKey, newSecret, stopKey } from "@/lib/developer/source";
import { developerKeysScreens } from "@/lib/screens/flag";

/**
 * Settings > Developer API keys, TEST mode only (Owner and Admin; the API asks for the second factor and decides again). The SECRET of a new or rotated key is in the result of THIS call only, for the page to show once: it is not stored, logged, put in an address or kept by revalidating.
 * A name or a scope that does not fit is refused here before asking; "live" is never sent. In `mock` the same refusals are made by the cookie source.
 */
export type KeyResult = { key: DevKey; secret: string | null };
const NAME_MAX = 60;
const IP_MAX = 10;

async function gate(tenantId: string): Promise<{ token: string } | Failed> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (developerKeysScreens() === "off" || !isCanonicalUuid(tenantId)) return { ok: false, kind: "not_found", error: t("apierr.not_found") };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, kind: "forbidden", error: t("apierr.forbidden") };
  } catch (error) {
    return failureOf(error, t);
  }
  return { token: user.accessToken };
}
const fail = async (error: unknown): Promise<Failed> => failureOf(error, appT(await getLang()));

export async function createKeyAction(tenantId: string, input: { name: string; scopes: string[]; ipAllow: string[] }): Promise<Reply<KeyResult>> {
  const g = await gate(tenantId);
  if (!("token" in g)) return g;
  const name = String(input.name ?? "").trim();
  const scopes = [...new Set((Array.isArray(input.scopes) ? input.scopes : []).filter((s): s is KeyScope => (KEY_SCOPES as readonly string[]).includes(s)))];
  const ipAllow = (Array.isArray(input.ipAllow) ? input.ipAllow : []).map((i) => String(i).trim()).filter((i) => i !== "");
  if (name.length < 1 || name.length > NAME_MAX || scopes.length < 1 || ipAllow.length > IP_MAX || ipAllow.some((i) => i.length > 50)) return { ok: false, kind: "invalid", error: appT(await getLang())("apierr.invalid"), code: "validation_error" };
  try {
    const made = await makeKey(g.token, tenantId, { name, scopes, ipAllow });
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data: { key: made.key, secret: made.secret } };
  } catch (error) {
    return fail(error);
  }
}

export async function rotateKeyAction(tenantId: string, keyId: string): Promise<Reply<KeyResult>> {
  const g = await gate(tenantId);
  if (!("token" in g)) return g;
  if (!isCanonicalUuid(keyId)) return { ok: false, kind: "not_found", error: appT(await getLang())("apierr.not_found") };
  try {
    const made = await newSecret(g.token, tenantId, keyId);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data: { key: made.key, secret: made.secret } };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeKeyAction(tenantId: string, keyId: string): Promise<Reply<KeyResult>> {
  const g = await gate(tenantId);
  if (!("token" in g)) return g;
  if (!isCanonicalUuid(keyId)) return { ok: false, kind: "not_found", error: appT(await getLang())("apierr.not_found") };
  try {
    const key = await stopKey(g.token, tenantId, keyId);
    revalidatePath(`/app/tenants/${tenantId}/settings`);
    return { ok: true, data: { key, secret: null } };
  } catch (error) {
    return fail(error);
  }
}
