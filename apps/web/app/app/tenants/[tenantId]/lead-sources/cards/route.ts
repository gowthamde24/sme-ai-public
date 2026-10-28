import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { cardsMode, sourcesApiFor } from "@/lib/sources/server";

import { fromThisSite } from "../../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/lead-sources/cards: the source cards' calls, one JSON request each, always this person's own token (it stays here), Owner and Admin only, only where SOURCE_CARDS_SCREENS is on and only from this site:
 *   {op: "cards"} · {op: "meta_connect"} · {op: "meta_pages"} · {op: "meta_select", pageId} · {op: "meta_disconnect"} · {op: "indiamart_key", key} · {op: "indiamart_disconnect"} · {op: "email", rotate?} · {op: "website"}
 * Answers are `{ok: true, data}` or `{ok: false, error: <closed word>}`. A key is passed on and forgotten: it is never logged, stored or returned. A plain route, not a server action: the page must not redraw under a half-filled form.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const mode = cardsMode();
  if (mode === "off" || !isCanonicalUuid(tenantId) || !fromThisSite(request)) return new NextResponse(null, { status: 404, headers });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new NextResponse(null, { status: 401, headers });
  }
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.text();
    const json: unknown = raw.length <= 2000 ? JSON.parse(raw) : null;
    body = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return new NextResponse(null, { status: 400, headers });
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 404, headers });
  }
  if (role !== "owner" && role !== "admin") return new NextResponse(null, { status: 404, headers });
  const api = sourcesApiFor(mode, user.accessToken, tenantId);
  if (!api) return new NextResponse(null, { status: 404, headers });
  const bad = new NextResponse(null, { status: 400, headers });
  try {
    let done;
    switch (body.op) {
      case "cards":
        done = await api.cards();
        break;
      case "meta_connect":
        done = await api.metaConnect();
        break;
      case "meta_pages":
        done = await api.metaPages();
        break;
      case "meta_select":
        if (typeof body.pageId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.pageId)) return bad;
        done = await api.metaSelect(body.pageId);
        break;
      case "meta_disconnect":
        done = await api.metaDisconnect();
        break;
      case "indiamart_key":
        if (typeof body.key !== "string" || body.key.trim().length < 4 || body.key.length > 200) return bad;
        done = await api.indiaMartKey(body.key.trim());
        break;
      case "indiamart_disconnect":
        done = await api.indiaMartDisconnect();
        break;
      case "email":
        done = await api.email(body.rotate === true);
        break;
      case "website":
        done = await api.website();
        break;
      default:
        return bad;
    }
    return NextResponse.json(done, { headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 502, headers });
  }
}
