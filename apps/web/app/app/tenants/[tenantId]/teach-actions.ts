"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { teach, undo } from "@/lib/corrections/source";

/** "Teach this" (owner, 13 Nov 2026): Owner and Admin save a corrected answer into Knowledge, and undo it. The answer is a sentence in our words, never the API's. */
export type TeachResult = { ok: true; id: string } | { ok: false; error: string };
export type UndoResult = { ok: true } | { ok: false; error: string };

async function who(tenantId: string): Promise<{ token: string } | null> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return null;
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    return role === "owner" || role === "admin" ? { token: user.accessToken } : null;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}

export async function teachAction(tenantId: string, input: unknown): Promise<TeachResult> {
  const t = appT(await getLang());
  const me = await who(tenantId);
  if (!me) return { ok: false, error: t("dst.teach.err.role") };
  const i = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const out = await teach(me.token, tenantId, { source: i.source, sourceId: i.sourceId, lineIndex: i.lineIndex, answer: i.answer });
  if (!out.ok) return { ok: false, error: t(out.error === "invalid" ? "dst.teach.err.invalid" : out.error === "forbidden" ? "dst.teach.err.role" : "dst.teach.err.down") };
  revalidatePath(`/app/tenants/${tenantId}/my-assistant`);
  return out;
}

export async function undoTeachAction(tenantId: string, id: unknown): Promise<UndoResult> {
  const t = appT(await getLang());
  const me = await who(tenantId);
  if (!me) return { ok: false, error: t("dst.teach.err.role") };
  const out = await undo(me.token, tenantId, id);
  if (!out.ok) return { ok: false, error: t(out.error === "forbidden" ? "dst.teach.err.role" : "dst.teach.err.down") };
  revalidatePath(`/app/tenants/${tenantId}/my-assistant`);
  return { ok: true };
}
