"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { isCanonicalUuid } from "@/lib/api/crm";
import { hiddenStepsCookie, parseHidden, serializeHidden, STEP_IDS } from "@/lib/packs/hidden-steps";
import { requireUser } from "@/lib/auth/session";

const YEAR = 60 * 60 * 24 * 365;

/** Puts one "Finish setting up" step away from Today (`hide`) or brings it back (`show`). A cookie of this browser, per workspace; nothing is changed on the server. */
export async function setStepHiddenAction(tenantId: string, formData: FormData): Promise<void> {
  const id = String(formData.get("step") ?? "");
  const hide = formData.get("do") !== "show";
  if (!isCanonicalUuid(tenantId) || !(STEP_IDS as readonly string[]).includes(id)) return;
  await requireUser();
  const jar = await cookies();
  const name = hiddenStepsCookie(tenantId);
  const now = parseHidden(jar.get(name)?.value);
  const next = hide ? [...now, id as (typeof STEP_IDS)[number]] : now.filter((s) => s !== id);
  jar.set(name, serializeHidden(next), { path: "/app", sameSite: "lax", maxAge: YEAR, secure: process.env.NODE_ENV === "production" });
  revalidatePath(`/app/tenants/${tenantId}`, "layout");
}
