"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { ApiRequestError } from "@/lib/api/client";
import { putAssistantName } from "@/lib/api/ai-assistant";
import { saveAssistant, testCall, type SaveResult } from "@/lib/assistant/source";
import { validName } from "@/lib/assistant/types";
import { assistantScreens } from "@/lib/screens/flag";
import type { TestCallResult } from "@/lib/assistant/test-call";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";

/**
 * Saving Settings > AI assistant (job DM): a signed-in person who is the Owner of the workspace (the API says which; the assistant is the Owner's to set up), the value checked by `parseSettings` (anything that is not in its shape is
 * `invalid`), then lib/assistant/source.ts: the fake cookie (ASSISTANT_SCREENS=mock) or C1's API (=1; the Owner needs the second factor: `mfa`). With the flag off or the API missing it answers `not_available` and changes nothing.
 */
export async function saveAssistantAction(tenantId: string, input: unknown): Promise<SaveResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { ok: false, error: "not_available" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const pack = await readPackCached(user.accessToken, tenantId);
  let result: SaveResult;
  try {
    result = await saveAssistant({ token: user.accessToken, tenantId }, input, pack?.modules ?? null);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  if (result.ok) revalidatePath(`/app/tenants/${tenantId}/settings`);
  return result;
}

/** The simulated test call (job DQ part 3): the Owner of the workspace only; no call is made, nothing is sent or stored. */
export async function testCallAction(tenantId: string): Promise<TestCallResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "not_available" };
  let shop = "";
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner") return { ok: false, error: "not_available" };
    shop = tenant.name;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  const pack = await readPackCached(user.accessToken, tenantId);
  return testCall({ token: user.accessToken, tenantId }, shop, pack?.modules ?? null);
}

export type RenameResult = { ok: true; name: string | null } | { ok: false; error: "invalid" | "not_available" | "read_only" };

/**
 * The assistant's name on its own (Settings home, owner 15 Nov; C1's `PUT /ai-assistant/name`): the Owner or an Admin, no second factor. `null` or blank = no name ("your assistant"). The same call with the earlier name is the undo. A name that is
 * not letters (a letter, then letters, digits, spaces; at most 24) is refused here before the API is asked. Only with the screens on (ASSISTANT_SCREENS=1): the cookie mock has no name of its own.
 */
export async function renameAssistantAction(tenantId: string, name: string | null): Promise<RenameResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || assistantScreens() !== "on") return { ok: false, error: "not_available" };
  const wanted = name === null || name.trim() === "" ? null : name.trim();
  if (wanted !== null && (!validName(wanted) || Array.from(wanted).length > 24)) return { ok: false, error: "invalid" };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return { ok: false, error: "not_available" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "not_available" };
  }
  try {
    const saved = await putAssistantName(user.accessToken, tenantId, wanted);
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true, name: saved };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 422) return { ok: false, error: "invalid" };
    if (error instanceof ApiRequestError && error.code === "workspace_read_only") return { ok: false, error: "read_only" };
    return { ok: false, error: "not_available" };
  }
}
