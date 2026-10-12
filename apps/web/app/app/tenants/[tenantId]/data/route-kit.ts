import type { NextRequest } from "next/server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf, type Failure, type FailureKind } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";

/**
 * What the Data routes share (job CC, screen 1): the browser cannot call the API (it never holds the token), so a file goes to these routes, which add the person's own token and pass it on. A request from another
 * site is refused, a rejected session is a plain 401 (a fetch cannot follow a sign-in redirect), and a refusal from the API comes back as ONE closed shape the screen has a sentence for.
 */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

const STATUS: Record<FailureKind, number> = { forbidden: 403, mfa: 403, rate_limited: 429, too_big: 413, invalid: 422, not_found: 404, conflict: 409, unavailable: 503, other: 500 };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...extra } });
}

/** A failure as the answer of a route: our sentence, the kind and the closed code, with the matching HTTP status (and Retry-After for a 429). */
export function failureResponse(f: Failure): Response {
  const { ok: _ok, ...rest } = f;
  void _ok;
  return json({ ok: false, ...rest }, STATUS[f.kind], f.retryAfter !== undefined ? { "Retry-After": String(f.retryAfter) } : {});
}

export type Guarded = { user: Awaited<ReturnType<typeof requireUser>>; tenantId: string };

/** The same-site, signed-in, valid-workspace checks every Data route starts with. A Response is the refusal to return. */
export async function guard(request: NextRequest, params: Promise<{ tenantId: string }>): Promise<Guarded | Response> {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  try {
    return { user: await requireUser(), tenantId };
  } catch {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }
}

/** A call to the API, run for a route: its failure becomes a failureResponse (a rejected session is a 401, not a redirect). */
export async function run<T>(work: () => Promise<T>): Promise<Response> {
  const t = appT(await getLang());
  try {
    return json({ ok: true, data: await work() });
  } catch (error) {
    try {
      return failureResponse(failureOf(error, t));
    } catch {
      return new Response("Unauthorized", { status: 401, headers: NO_STORE }); // failureOf redirects a rejected session; a fetch gets a plain 401
    }
  }
}
