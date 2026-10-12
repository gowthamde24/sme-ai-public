import type { NextRequest } from "next/server";

import { confirmSpreadsheet, inspectSpreadsheet, MAX_IMPORT_BYTES, previewSpreadsheet } from "@/lib/api/data";
import { isCanonicalUuid } from "@/lib/api/crm";

import { guard, json, NO_STORE, run } from "../../route-kit";

export const dynamic = "force-dynamic";

const KINDS = ["customers", "stock"];

/** The mapping the screen sends: {field: column number}, small, closed field words. Anything else is not sent on. */
function parseMapping(raw: string | null): Record<string, number> | null | "bad" {
  if (raw === null) return null;
  try {
    const m: unknown = JSON.parse(raw);
    if (typeof m !== "object" || m === null || Array.isArray(m)) return "bad";
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
      if (!/^[a-z_]{1,40}$/.test(k) || typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1000) return "bad";
      out[k] = v;
    }
    return out;
  } catch {
    return "bad";
  }
}

/**
 * POST /app/tenants/[tenantId]/data/import/inspect | preview | confirm (job CC): the spreadsheet import, step by step. The request body IS the file (the API reads the raw bytes); the query says the kind
 * (customers or stock), the job (a uuid the screen makes) and the column choices. Nothing is stored here. The API holds the file in memory for the one request; Owner and Admin only, and `confirm` needs the second factor
 * (the API answers 403 mfa_required, which the screen turns into the way to Security).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; step: string }> }) {
  const { step } = await params;
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  if (!["inspect", "preview", "confirm"].includes(step)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_IMPORT_BYTES) return json({ ok: false, kind: "too_big", code: "file_too_large", error: "" }, 413);
  const file = await request.arrayBuffer();
  if (file.byteLength > MAX_IMPORT_BYTES) return json({ ok: false, kind: "too_big", code: "file_too_large", error: "" }, 413);
  const contentType = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const jobId = url.searchParams.get("job_id") ?? "";
  if (step !== "confirm" && !KINDS.includes(kind)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  if (step !== "inspect" && !isCanonicalUuid(jobId)) return new Response("Bad request", { status: 400, headers: NO_STORE });
  const mapping = parseMapping(url.searchParams.get("mapping"));
  if (mapping === "bad") return new Response("Bad request", { status: 400, headers: NO_STORE });

  if (step === "inspect") return run(() => inspectSpreadsheet(user.accessToken, tenantId, kind, file, contentType));
  if (step === "preview") return run(() => previewSpreadsheet(user.accessToken, tenantId, kind, jobId, mapping, file, contentType));
  return run(() => confirmSpreadsheet(user.accessToken, tenantId, jobId, file, contentType));
}
