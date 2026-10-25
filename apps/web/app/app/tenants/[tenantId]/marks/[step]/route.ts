import type { NextRequest } from "next/server";

import { ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { MockRefusal, preview, send } from "@/lib/marks/source";
import { MAX_BYTES, isKind, isLang } from "@/lib/marks/types";
import { marksScreens } from "@/lib/screens/flag";

import { guard, json, NO_STORE, run } from "../../data/route-kit";

export const dynamic = "force-dynamic";

const STATUS = { marks_file_too_large: 413, marks_file_changed: 409, marks_count_changed: 409 } as const;

/**
 * POST /app/tenants/[tenantId]/marks/preview | send (job DP): the school's marks and report-card messages. The browser never holds the token, so the file comes here and goes on with the person's own token. The request body IS the
 * file, held in memory for this one request and never stored; the query says the kind, the language, the exam name and (for `send`) the batch id and what the preview showed (its SHA-256 and count), so only the file that was
 * checked can be sent. Owner and Admin read the preview; `send` is the Owner's, with the second factor (the API answers 403 `mfa_required`).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; step: string }> }) {
  const { step } = await params;
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  if (marksScreens() === "off" || !["preview", "send"].includes(step)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) return json({ ok: false, kind: "too_big", code: "marks_file_too_large", error: "" }, 413);
  const file = await request.arrayBuffer();
  if (file.byteLength > MAX_BYTES) return json({ ok: false, kind: "too_big", code: "marks_file_too_large", error: "" }, 413);
  const contentType = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100);
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind");
  const language = q.get("language") ?? "en";
  const term = (q.get("term") ?? "").trim().slice(0, 40);
  if (!isKind(kind) || !isLang(language) || /[<>{}@/\\|\u0000-\u001f]/.test(term)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const ctx = { token: user.accessToken, tenantId };
  const failMock = (e: unknown): never => {
    throw e instanceof MockRefusal ? new ApiRequestError(STATUS[e.code as keyof typeof STATUS] ?? 422, e.code, "") : e;
  };
  if (step === "preview") return run(() => preview(ctx, file, contentType, { kind, language, term }).catch(failMock));
  const batchId = q.get("batch_id") ?? "";
  const sha256 = q.get("expect_sha256") ?? "";
  const count = Number(q.get("expect_count"));
  if (!isCanonicalUuid(batchId) || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isInteger(count) || count < 0 || count > 5000) return new Response("Bad request", { status: 400, headers: NO_STORE });
  return run(() => send(ctx, file, contentType, { kind, language, term, batchId, sha256, count }).catch(failMock));
}
