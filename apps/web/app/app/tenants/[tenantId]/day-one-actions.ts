"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { goLive, connectMockPhone, type Moved } from "@/lib/assistant-status/go-live";
import { writeChoice } from "@/lib/assistant-status/setup-choice";
import { requireUser } from "@/lib/auth/session";
import { designV6 } from "@/lib/screens/flag";

/**
 * The server actions of Today's day-one checklist (design system v6, owner 13 Nov 2026), bound to the workspace by the page. "Skip for now" and the chip's cross only write a cookie of this browser; "Go live with defaults" is the Owner's (C1's
 * `POST /assistant/go-live`, or the mock cookie on staging); "Use a test number" connects the made-up number of the mock. Every move checks the person's role again and answers a closed word.
 */
async function who(tenantId: string): Promise<{ token: string; role: string; name: string } | null> {
  if (!designV6() || !isCanonicalUuid(tenantId)) return null;
  const user = await requireUser();
  try {
    const t = await fetchTenant(user.accessToken, tenantId);
    return { token: user.accessToken, role: t.role, name: t.name };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return null;
  }
}
const manages = (role: string): boolean => role === "owner" || role === "admin";

export async function skipSetupAction(tenantId: string): Promise<void> {
  const me = await who(tenantId);
  if (!me || !manages(me.role)) return;
  await writeChoice(tenantId, "skipped");
  revalidatePath(`/app/tenants/${tenantId}`);
}

export async function dismissChipAction(tenantId: string): Promise<void> {
  const me = await who(tenantId);
  if (!me || !manages(me.role)) return;
  await writeChoice(tenantId, "dismissed");
  revalidatePath(`/app/tenants/${tenantId}`);
}

export type GoLiveResult = { ok: boolean; missing: ("business_name" | "phone_number")[] };

export async function goLiveAction(tenantId: string): Promise<GoLiveResult> {
  const me = await who(tenantId);
  if (!me || me.role !== "owner") return { ok: false, missing: [] };
  const out: Moved = await goLive(me.token, tenantId, me.name);
  if (out.ok) {
    revalidatePath(`/app/tenants/${tenantId}`);
    return { ok: true, missing: [] };
  }
  return { ok: false, missing: out.missing };
}

export async function testNumberAction(tenantId: string): Promise<void> {
  const me = await who(tenantId);
  if (!me || !manages(me.role)) return;
  if (await connectMockPhone()) revalidatePath(`/app/tenants/${tenantId}`);
}
