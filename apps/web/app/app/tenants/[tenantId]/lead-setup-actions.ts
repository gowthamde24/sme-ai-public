"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { FACT_KINDS, FILE_TYPES, type Fact, type FactKind, type KDone, type KnowledgeSource } from "@/lib/lead-desk/knowledge";
import * as knowledge from "@/lib/lead-desk/knowledge-source";
import type { PDone, PlaybookRead } from "@/lib/lead-desk/playbook";
import { readPlaybook, resetToTemplate, savePlaybook } from "@/lib/lead-desk/playbook-source";
import { readPackCached } from "@/lib/packs/read";
import { leadsScreens } from "@/lib/screens/flag";

/**
 * The changes of the Lead Desk setup (night 4, part A1/A2): the knowledge base (sources the owner gives, the facts the AI drafts, each decision) and the playbook (the goal sentence and the questions). Owner and Admin manage the
 * knowledge; the playbook is the Owner's (the API asks the second factor for it and for a price). Each action checks who is asking, refuses while the flag is off, and answers in closed words. The assistant states only what is approved.
 */
type Role = "owner" | "admin" | "sales" | "viewer";
const MANAGERS: readonly Role[] = ["owner", "admin"];
const OWNER: readonly Role[] = ["owner"];

async function who(tenantId: string, allowed: readonly Role[]): Promise<{ token: string; tenantId: string; packId: string | null } | null> {
  const user = await requireUser();
  if (leadsScreens() === "off" || !isCanonicalUuid(tenantId)) return null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (!(allowed as readonly string[]).includes(tenant.role)) return null;
    const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
    return { token: user.accessToken, tenantId, packId: pack?.packId ?? null };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const no = <T>(): KDone<T> => ({ ok: false, error: "not_available" });
const bad = <T>(): KDone<T> => ({ ok: false, error: "invalid" });
const touch = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/lead-setup`);
const uuid = (v: unknown): v is string => typeof v === "string" && isCanonicalUuid(v);

export async function addPasteAction(tenantId: string, input: { sourceId: string; title: string; text: string }): Promise<KDone<KnowledgeSource>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(input?.sourceId) || typeof input.title !== "string" || typeof input.text !== "string") return bad();
  const out = await knowledge.addPaste(ctx, input);
  if (out.ok) touch(tenantId);
  return out;
}

export async function addFileAction(tenantId: string, input: { sourceId: string; title: string; filename: string; contentType: string; contentBase64: string }): Promise<KDone<KnowledgeSource>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  const ext = typeof input?.filename === "string" ? (input.filename.split(".").pop() ?? "").toLowerCase() : "";
  if (!uuid(input?.sourceId) || typeof input.title !== "string" || !(ext in FILE_TYPES) || typeof input.contentBase64 !== "string" || !/^[A-Za-z0-9+/=\s]*$/.test(input.contentBase64)) return { ok: false, error: ext in FILE_TYPES ? "invalid" : "unsupported" };
  const out = await knowledge.addFile(ctx, { ...input, contentType: FILE_TYPES[ext] });
  if (out.ok) touch(tenantId);
  return out;
}

export async function draftFactsAction(tenantId: string, sourceId: string): Promise<KDone<Fact[]>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(sourceId)) return bad();
  const out = await knowledge.draft(ctx, sourceId);
  if (out.ok) touch(tenantId);
  return out;
}

export async function addFactAction(tenantId: string, input: { factId: string; kind: FactKind; text: string }): Promise<KDone<Fact>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(input?.factId) || !(FACT_KINDS as readonly string[]).includes(input.kind)) return bad();
  const out = await knowledge.addManual(ctx, input);
  if (out.ok) touch(tenantId);
  return out;
}

export async function editFactAction(tenantId: string, factId: string, input: { text: string; kind?: FactKind }): Promise<KDone<Fact>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(factId) || (input?.kind !== undefined && !(FACT_KINDS as readonly string[]).includes(input.kind))) return bad();
  const out = await knowledge.edit(ctx, factId, input);
  if (out.ok) touch(tenantId);
  return out;
}

/** One fact approved or rejected. A price needs the Owner with the second factor: the API says so (`mfa`). */
export async function decideFactAction(tenantId: string, factId: string, decision: "approve" | "reject"): Promise<KDone<Fact>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(factId) || (decision !== "approve" && decision !== "reject")) return bad();
  const out = await knowledge.decide(ctx, factId, decision);
  if (out.ok) touch(tenantId);
  return out;
}

export async function discardSourceAction(tenantId: string, sourceId: string): Promise<KDone<KnowledgeSource>> {
  const ctx = await who(tenantId, MANAGERS);
  if (!ctx) return no();
  if (!uuid(sourceId)) return bad();
  const out = await knowledge.discard(ctx, sourceId);
  if (out.ok) touch(tenantId);
  return out;
}

export async function savePlaybookAction(tenantId: string, input: unknown): Promise<PDone<PlaybookRead>> {
  const ctx = await who(tenantId, OWNER);
  if (!ctx) return { ok: false, error: "not_available" };
  const current = await readPlaybook(ctx, ctx.packId);
  if (!current) return { ok: false, error: "not_available" };
  const out = await savePlaybook(ctx, current, input);
  if (out.ok) touch(tenantId);
  return out;
}

export async function resetPlaybookAction(tenantId: string): Promise<PDone<PlaybookRead>> {
  const ctx = await who(tenantId, OWNER);
  if (!ctx) return { ok: false, error: "not_available" };
  const current = await readPlaybook(ctx, ctx.packId);
  if (!current) return { ok: false, error: "not_available" };
  const out = await resetToTemplate(ctx, current);
  if (out.ok) touch(tenantId);
  return out;
}
