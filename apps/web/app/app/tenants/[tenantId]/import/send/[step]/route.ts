import type { NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { runImportStep, type Step } from "@/lib/lead-desk/imports/run";
import { MAX_BASE64_CHARS, MAX_TEXT_CHARS } from "@/lib/lead-desk/imports/types";

import { guard, json, NO_STORE } from "../../../data/route-kit";

export const dynamic = "force-dynamic";

const STEPS = ["read", "preview", "import"];
const STATUS = { forbidden: 403, mfa: 403, read_only: 403, consent_owner_only: 403, too_large: 413, rate_limited: 429, not_available: 404, down: 503 } as const;

/**
 * POST /app/tenants/[tenantId]/import/send/read | preview | import (night 4, Lead Desk, item 3): the same three steps as the server actions, for a FILE. A file of up to 3 MB is about 4 MB as base64, more than a server
 * action's body may be, so the browser posts the JSON body here; the person's own token is added on the server. Same checks as the actions (lib/lead-desk/imports/run.ts): the role, the flag, the shape. The answer is
 * `{ok:true,data}` or `{ok:false,error}` (a closed word). Nothing is stored or logged here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; step: string }> }) {
  const { step } = await params;
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  if (!STEPS.includes(step)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const declared = Number(request.headers.get("content-length") ?? "0");
  const ceiling = MAX_BASE64_CHARS + MAX_TEXT_CHARS + 20_000;
  if (Number.isFinite(declared) && declared > ceiling) return json({ ok: false, error: "too_large" }, 413);
  let input: unknown;
  try {
    const text = await request.text();
    if (text.length > ceiling) return json({ ok: false, error: "too_large" }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ ok: false, error: "invalid" }, 422);
  }
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch {
    return new Response("Not found", { status: 404, headers: NO_STORE });
  }
  let out;
  try {
    out = await runImportStep({ ctx: { token: user.accessToken, tenantId }, role }, step as Step, input);
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: NO_STORE });
    return json({ ok: false, error: "down" }, 503);
  }
  if (out.ok) return json(out);
  return json(out, STATUS[out.error as keyof typeof STATUS] ?? 422);
}
