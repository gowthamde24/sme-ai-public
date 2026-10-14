"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { loadExampleData, removeExampleData, type ExampleResult } from "@/lib/api/example-data";
import { saveProfile } from "@/lib/api/profile";
import { requireUser } from "@/lib/auth/session";

export type ProfileState = { ok: true } | { ok: false; error: "invalid" | "role" | "failed" | "session" } | undefined;

const ADMINS = ["owner", "admin"];

async function adminOf(tenantId: string) {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  const tenant = await fetchTenant(user.accessToken, tenantId).catch((e) => {
    if (e instanceof ApiAuthError) throw e;
    return null;
  });
  return tenant && ADMINS.includes(tenant.role) ? { user, tenant } : null;
}

/** Step 1 of every checklist, asked in context: the business name and the city. Owner or Admin; the API checks again. */
export async function saveProfileAction(tenantId: string, _prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const name = String(formData.get("name") ?? "").trim();
  const town = String(formData.get("town") ?? "").trim();
  if (name.length < 1 || name.length > 120 || town.length < 2 || town.length > 80) return { ok: false, error: "invalid" };
  try {
    const who = await adminOf(tenantId);
    if (!who) return { ok: false, error: "role" };
    await saveProfile(who.user.accessToken, tenantId, { name, town });
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiAuthError) return { ok: false, error: "session" };
    if (error instanceof ApiRequestError && error.status === 403) return { ok: false, error: "role" };
    return { ok: false, error: "failed" };
  }
}

async function exampleAction(tenantId: string, run: (token: string, id: string) => Promise<{ result: ExampleResult; kept?: number }>, done: "loaded" | "removed"): Promise<void> {
  let notice: string = "failed";
  let kept = 0;
  try {
    const who = await adminOf(tenantId);
    if (who) {
      const out = await run(who.user.accessToken, tenantId);
      notice = out.result === "ok" ? done : out.result === "unavailable" ? "unavailable" : "failed";
      kept = out.kept ?? 0;
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
  }
  revalidatePath(`/app/tenants/${tenantId}`, "layout");
  redirect(`/app/tenants/${tenantId}?example=${notice}${kept > 0 ? `&kept=${kept}` : ""}`);
}
/** "Load example data" (blueprint 3.2). Safe to press twice: the server keeps one sample set. */
export async function loadExampleAction(tenantId: string): Promise<void> {
  return exampleAction(tenantId, async (token, id) => ({ result: await loadExampleData(token, id) }), "loaded");
}
/** "Remove example data": removes only the sample's own rows that nobody has used; the others stay and are counted. */
export async function removeExampleAction(tenantId: string): Promise<void> {
  return exampleAction(
    tenantId,
    async (token, id) => {
      const out = await removeExampleData(token, id);
      const k = out.removed?.kept;
      return { result: out.result, kept: k ? k.companies + k.contacts + k.leads + k.products : 0 };
    },
    "removed",
  );
}
