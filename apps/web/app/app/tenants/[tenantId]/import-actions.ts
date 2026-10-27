"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { runImportStep, runSheetLink, runSheetLinkAct, type Who } from "@/lib/lead-desk/imports/run";
import type { ImportResult, Out, PreviewResult, ReadResult, SheetLink } from "@/lib/lead-desk/imports/types";

/**
 * The writes of the import screen (night 4, Lead Desk, item 3). Every input is whatever the browser sent: it is checked in lib/lead-desk/imports/types.ts (strict, nothing else is passed on), the role and the flag in
 * lib/lead-desk/imports/run.ts (Viewer: nothing; Sales: no consent confirmation; the sheet links: Owner and Admin), then lib/lead-desk/imports/source.ts: test mode (a cookie) or C1's API. A file travels through the route
 * `import/send/[step]` instead (it is too big for the body of a server action); the logic is the same. An answer is `{ok, data}` or one closed word. Nothing here logs a body.
 */
async function whoIs(tenantId: string): Promise<Who | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    return { ctx: { token: user.accessToken, tenantId }, role: tenant.role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const NOT_THERE = { ok: false, error: "not_available" } as const;
/** A session the API rejected while a step ran is the sign-in page, like everywhere else. */
async function signedIn<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    throw error;
  }
}

export async function readLeadsAction(tenantId: string, input: unknown): Promise<Out<ReadResult>> {
  const who = await whoIs(tenantId);
  return who ? ((await signedIn(() => runImportStep(who, "read", input))) as Out<ReadResult>) : NOT_THERE;
}

export async function previewLeadsAction(tenantId: string, input: unknown): Promise<Out<PreviewResult>> {
  const who = await whoIs(tenantId);
  return who ? ((await signedIn(() => runImportStep(who, "preview", input))) as Out<PreviewResult>) : NOT_THERE;
}

export async function importLeadsAction(tenantId: string, input: unknown): Promise<Out<ImportResult>> {
  const who = await whoIs(tenantId);
  if (!who) return NOT_THERE;
  const out = (await signedIn(() => runImportStep(who, "import", input))) as Out<ImportResult>;
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/import`);
  return out;
}

export async function createSheetLinkAction(tenantId: string, input: unknown): Promise<Out<SheetLink>> {
  const who = await whoIs(tenantId);
  if (!who) return NOT_THERE;
  const out = await signedIn(() => runSheetLink(who, input));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/import`);
  return out;
}

export async function sheetLinkAction(tenantId: string, linkId: string, what: "sync" | "pause" | "resume"): Promise<Out<SheetLink>> {
  const who = await whoIs(tenantId);
  if (!who) return NOT_THERE;
  const out = await signedIn(() => runSheetLinkAct(who, linkId, what));
  if (out.ok) revalidatePath(`/app/tenants/${tenantId}/import`);
  return out;
}
