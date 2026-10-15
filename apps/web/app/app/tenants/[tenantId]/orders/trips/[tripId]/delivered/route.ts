import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { MAX_PROOF_BYTES, PROOF_TYPES, markDelivered } from "@/lib/api/deliveries";
import { requireUser } from "@/lib/auth/session";
import { fromThisSite } from "@/lib/security/same-site";

export const dynamic = "force-dynamic";

const JSON_HEAD = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEAD });
const refuse = (status: number, code: string) => reply(status, { ok: false, code });
const SLACK = 65_536;

/**
 * "Delivered, with the proof" (job CO): the sheet posts ONE photo here as the raw body (its own Content-Type) with `received_by` (the name of the person who received the goods) and `photo_id` (a retry key), because only
 * the server holds the person's token and the browser may talk to this app only (CSP connect-src). It checks the request is from this site, the person is signed in, the type and size are plausible, and passes the bytes
 * to the API with the person's OWN token; the API checks the photo from its bytes, stores it in a private bucket and records the delivery. The answer is `{ok: true}` or `{ok: false, code}` with the API's closed code.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; tripId: string }> }) {
  const { tenantId, tripId } = await params;
  const photoId = request.nextUrl.searchParams.get("photo_id") ?? "";
  const receivedBy = (request.nextUrl.searchParams.get("received_by") ?? "").trim();
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(tripId) || !isCanonicalUuid(photoId)) return refuse(404, "not_found");
  if (receivedBy === "" || receivedBy.length > 80) return refuse(422, "proof_incomplete");
  if (!fromThisSite(request)) return refuse(403, "forbidden");
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(PROOF_TYPES as readonly string[]).includes(type)) return refuse(415, "photo_type_unsupported");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PROOF_BYTES + SLACK) return refuse(413, "photo_too_large");
  let user;
  try {
    user = await requireUser();
  } catch {
    return refuse(401, "unauthorized");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return refuse(422, "photo_unreadable");
  if (body.byteLength > MAX_PROOF_BYTES + SLACK) return refuse(413, "photo_too_large");
  try {
    await markDelivered(user.accessToken, tenantId, tripId, receivedBy, photoId, body, type);
    return reply(200, { ok: true });
  } catch (error) {
    if (error instanceof ApiAuthError) return refuse(401, "unauthorized");
    if (error instanceof ApiRequestError) return refuse(error.status >= 400 && error.status < 600 ? error.status : 502, /^[a-z_]{1,40}$/.test(error.code) ? error.code : "http_error");
    return refuse(502, "bad_answer");
  }
}
