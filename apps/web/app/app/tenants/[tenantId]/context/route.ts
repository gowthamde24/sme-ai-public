import { NextResponse, type NextRequest } from "next/server";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { apiFor, contextMode } from "@/lib/context/server";
import { FILE_MAX_BYTES, NOTES_MAX, UNDERSTAND_KINDS, type UnderstandKind } from "@/lib/context/types";

import { fromThisSite } from "../ask/ask-response";

export const dynamic = "force-dynamic";

/**
 * POST /app/tenants/[tenantId]/context: the "About my business" screen's calls, one JSON request each, always this person's own token (it stays here), only where ABOUT_BUSINESS_SCREENS is on and only from this site:
 *   {op: "get"} {op: "versions"} {op: "version", version} {op: "restore", version}            read / history (any member); restore writes
 *   {op: "put", notes, version}                                                              autosave (Owner and Admin)
 *   {op: "understand", kind: "paste"|"file"|"voice", text?, filename?, contentBase64?, language?}   a PREVIEW, nothing saved
 *   {op: "save", previewId, notes, mode: "append"|"replace", version}                         saves the preview (the person's edit of it)
 *   {op: "test", question, language?}                                                        how the assistant would answer a customer
 * Answers are `{ok: true, data}` or `{ok: false, error: <closed word>}`: the API's own English is never passed on. A plain route, not a server action: autosave must not make Next draw the page again under the person's typing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const mode = contextMode();
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
    const json: unknown = raw.length <= Math.ceil((FILE_MAX_BYTES * 4) / 3) + 4000 ? JSON.parse(raw) : null; // a 3 MB file is about 4 MB as base64
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
  const api = apiFor(mode, user.accessToken, tenantId);
  if (!api) return new NextResponse(null, { status: 404, headers });
  const bad = new NextResponse(null, { status: 400, headers });
  const version = typeof body.version === "number" && Number.isInteger(body.version) && body.version >= 0 ? body.version : null;
  const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);
  const writes = ["put", "restore", "understand", "save", "test"];
  if (typeof body.op !== "string" || !["get", "versions", "version", ...writes].includes(body.op)) return bad;
  if (writes.includes(body.op) && role !== "owner" && role !== "admin") return NextResponse.json({ ok: false, error: "forbidden" }, { headers });
  try {
    let done;
    switch (body.op) {
      case "get":
        done = await api.get();
        break;
      case "versions":
        done = await api.versions();
        break;
      case "version":
        if (version === null) return bad;
        done = await api.versionText(version);
        break;
      case "restore":
        if (version === null) return bad;
        done = await api.restore(version);
        break;
      case "put": {
        const notes = str(body.notes, NOTES_MAX);
        if (notes === null || version === null) return bad;
        done = await api.put(notes, version);
        break;
      }
      case "understand": {
        const kind = body.kind as UnderstandKind;
        if (!(UNDERSTAND_KINDS as readonly unknown[]).includes(kind)) return bad;
        const text = body.text === undefined ? undefined : str(body.text, NOTES_MAX);
        const filename = body.filename === undefined ? undefined : str(body.filename, 200);
        const content = body.contentBase64 === undefined ? undefined : str(body.contentBase64, Math.ceil((FILE_MAX_BYTES * 4) / 3) + 4);
        const language = body.language === undefined ? undefined : str(body.language, 4);
        if (text === null || filename === null || content === null || language === null || (kind === "paste" ? !text : !content) || (content !== undefined && !/^[A-Za-z0-9+/]+={0,2}$/.test(content))) return bad;
        done = await api.understand({ kind, text, filename, contentBase64: content, language });
        break;
      }
      case "save": {
        const notes = str(body.notes, NOTES_MAX);
        if (notes === null || version === null || typeof body.previewId !== "string" || (body.mode !== "append" && body.mode !== "replace")) return bad;
        done = await api.save(body.previewId, notes, body.mode, version);
        break;
      }
      default: {
        const question = str(body.question, 500);
        const language = body.language === undefined ? undefined : str(body.language, 4);
        if (!question?.trim() || language === null) return bad;
        done = await api.test(question, language);
      }
    }
    return NextResponse.json(done, { headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof ApiAuthError ? 401 : 502, headers });
  }
}
