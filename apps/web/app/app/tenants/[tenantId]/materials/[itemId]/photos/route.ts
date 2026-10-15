import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { MAX_UPLOAD_BYTES, PHOTO_TYPES, uploadMaterialPhoto } from "@/lib/api/materials";
import { requireUser } from "@/lib/auth/session";
import { fromThisSite } from "@/lib/security/same-site";

export const dynamic = "force-dynamic";

const JSON_HEAD = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEAD });
const refuse = (status: number, code: string) => reply(status, { ok: false, code });
const SLACK = 65_536;

/**
 * "Add a photo" for a product (job CO), the same pass-through as the saree photos (job BC): the form posts ONE photo here as the raw body (its own Content-Type), because only the server holds the person's token and
 * the browser may talk to this app only (CSP connect-src). It checks the request is from this site, the person is signed in, the type and size are plausible, and passes the bytes to the API with the person's OWN token;
 * who may add a photo is decided by the API and the database (Owner and Admin). The answer is `{ok, photo, photos}` with fresh links, or `{ok: false, code}` with the API's closed code and never its text.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; itemId: string }> }) {
  const { tenantId, itemId } = await params;
  const photoId = request.nextUrl.searchParams.get("photo_id") ?? "";
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(itemId) || !isCanonicalUuid(photoId)) return refuse(404, "not_found");
  if (!fromThisSite(request)) return refuse(403, "forbidden");
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(PHOTO_TYPES as readonly string[]).includes(type)) return refuse(415, "photo_type_unsupported");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + SLACK) return refuse(413, "photo_too_large");
  let user;
  try {
    user = await requireUser();
  } catch {
    return refuse(401, "unauthorized");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return refuse(422, "photo_unreadable");
  if (body.byteLength > MAX_UPLOAD_BYTES + SLACK) return refuse(413, "photo_too_large");
  try {
    const out = await uploadMaterialPhoto(user.accessToken, tenantId, itemId, photoId, body, type);
    return reply(200, { ok: true, photo: out.photo, photos: out.item.photos, replayed: out.replayed });
  } catch (error) {
    if (error instanceof ApiAuthError) return refuse(401, "unauthorized");
    if (error instanceof ApiRequestError) return refuse(error.status >= 400 && error.status < 600 ? error.status : 502, /^[a-z_]{1,40}$/.test(error.code) ? error.code : "http_error");
    return refuse(502, "bad_answer");
  }
}
