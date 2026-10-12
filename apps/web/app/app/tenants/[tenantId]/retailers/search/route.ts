import type { NextRequest } from "next/server";

import { questionOf, queryProblem, searchRetailers } from "@/lib/api/retailers";
import { isCanonicalUuid } from "@/lib/api/crm";

import { guard, json, NO_STORE, run } from "../../data/route-kit";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/retailers/search (job CC): {kind, city, messageId}. The question is made here (so the browser cannot ask Agent OWL anything else through this door), the search is the assistant's map tool, and the answer is
 * the place cards (a stable id, a name, a Maps link), the words of the answer and, if the assistant refused, a closed code. Nothing is stored. Same-site only; the API checks the role and the allowances.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  let body: unknown;
  try {
    body = JSON.parse((await request.text()).slice(0, 2000));
  } catch {
    body = null;
  }
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (!b || typeof b.kind !== "string" || typeof b.city !== "string" || typeof b.messageId !== "string" || !isCanonicalUuid(b.messageId)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const problem = queryProblem(b.kind, b.city);
  if (problem) return json({ ok: false, kind: "invalid", error: "", code: `search_${problem}` }, 422);
  return run(() => searchRetailers(user.accessToken, tenantId, { messageId: b.messageId as string, text: questionOf(b.kind as string, b.city as string) }));
}
