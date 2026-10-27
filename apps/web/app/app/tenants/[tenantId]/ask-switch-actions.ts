"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { setAgentsEnabled } from "@/lib/api/agents";
import { getAgentsStatus } from "@/lib/api/today";
import { requireUser } from "@/lib/auth/session";

/** `live`: the assistant can be asked now. False = the workspace's switch is on but the system's own is not (the card says so). */
export type TurnOnResult = { ok: true; live: boolean } | { ok: false };

/**
 * "Turn on the assistant" from the question line of a workspace whose switch is off (first run: the workspace's own switch starts OFF, so the card had nowhere to type). The Owner or an Admin turns the workspace's own switch on (the API checks the role and
 * answers 403 for anyone else); the answer says whether the assistant is now live, read again from the helpers' status. Nothing else changes.
 */
export async function turnOnAssistantAction(tenantId: string): Promise<TurnOnResult> {
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return { ok: false };
  try {
    await setAgentsEnabled(user.accessToken, tenantId, true);
    const main = (await getAgentsStatus(user.accessToken, tenantId)).find((a) => a.agent === "main")?.state;
    revalidatePath(`/app/tenants/${tenantId}`, "layout");
    return { ok: true, live: main === "idle" || main === "working" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false };
  }
}
