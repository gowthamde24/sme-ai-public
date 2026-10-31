import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { CHAT_LANGUAGES, patchMyProfile } from "@/lib/api/me";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /app/tenants/[tenantId]/chat-language {language}: the language pill of the assistant chat remembers the person's choice (`preferred_chat_language` of their own member profile, C1's API: "auto" or one language). A plain POST,
 * not a server action (that would make Next draw the page again under the open chat). Same-site requests only; the person's OWN token, which the browser never holds; the answer is 204, or 422/401/503. Nothing else of the profile is touched.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  let language: unknown;
  try {
    language = (await request.json())?.language;
  } catch {
    language = null;
  }
  if (typeof language !== "string" || !CHAT_LANGUAGES.includes(language)) return new Response("Bad request", { status: 422, headers: NO_STORE });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }
  try {
    await patchMyProfile(user.accessToken, tenantId, { preferred_chat_language: language });
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: NO_STORE });
    if (error instanceof ApiRequestError && error.status === 422) return new Response("Bad request", { status: 422, headers: NO_STORE });
    return new Response("Unavailable", { status: 503, headers: NO_STORE });
  }
}
