import type { NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { fromThisSite } from "../ask/ask-response";
import { teamContext, type TeamCtx } from "./ai-team-data";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const plain = (status: number, text: string) => new Response(text, { status, headers: NO_STORE });

/** The routes of My AI team v2 (the day's polling, a helper's panel, the stand-up's sound): same-site GETs only, with the person's own token on the server; the v2 page off is 404, a rejected session 401, a role the API refuses its status. */
export async function teamRoute(request: NextRequest, tenantId: string, answer: (ctx: TeamCtx) => Promise<Response>): Promise<Response> {
  if (!fromThisSite(request)) return plain(403, "Forbidden");
  try {
    const ctx = await teamContext(tenantId);
    if (!ctx) return plain(404, "Not found");
    return await answer(ctx);
  } catch (error) {
    if (error instanceof ApiAuthError) return plain(401, "Unauthorized");
    if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404 || error.status === 422 || error.status === 429)) return plain(error.status, error.code ?? "refused");
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) return plain(401, "Unauthorized");
    return plain(502, "Unavailable");
  }
}
export const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8" } });
