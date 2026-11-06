import { type NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { searchRecords } from "@/lib/api/search";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

/** GET /app/tenants/[tenantId]/search?q= : the ⌘K palette's records (C1's GET /search with the person's own token, which the browser never holds). Same-site only. {items}; a rejected session is a plain 401; any other failure is no items. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    return new Response(JSON.stringify({ items: await searchRecords(user.accessToken, tenantId, q) }), { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: NO_STORE });
  }
}
