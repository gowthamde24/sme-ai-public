import { cache } from "react";

import { ApiAuthError, ApiRequestError, apiRequestOnce, isBusy, refusal } from "./client";

/**
 * One request for what the signed-in layout reads on every page (C1's Phase 1, docs/plans/call-capacity-and-instances.md section 2a, owner approved 12 Nov 2026): `GET /v1/tenants/{id}/bootstrap` answers
 * `{parts: {name: {ok, data, error:{code,status}}}, generated_at}`, each part being the SAME body as its own route, so every existing reader and parser works unchanged: `apiRequest` (client.ts) asks here first
 * for the routes in PARTS. SERVER ONLY (client.ts reaches this file only behind `typeof window === "undefined"`, so no browser ever loads it).
 * Behind BOOTSTRAP=1 (off by default). It is used only after the workspace layout has PRIMED it for this request (`primeBootstrap`): a route handler, which does not prime, keeps asking its own routes (a poll that needs
 * one number must not cause thirteen reads). A part that failed answers with the error its own route would give (a 403 on the AI usage for an Admin-less role, say); a part that timed out (503 busy), a part that is missing and an API
 * with no bootstrap route fall back to the part's own route; an API that refuses the WHOLE request as busy (its page limiter) makes every part busy, with no thirteen fallbacks piled on top of it.
 */
const PARTS: Record<string, string> = {
  "": "tenant",
  "/pack": "pack",
  "/modules": "modules",
  "/billing/access": "billing_access",
  "/billing/usage": "billing_usage",
  "/billing/entitlements": "billing_entitlements",
  "/ai-usage": "ai_usage",
  "/workspace/profile": "workspace_profile",
  "/lead-finder/availability": "lead_finder_availability",
  "/me/profile": "me_profile",
  "/today": "today",
  "/agents/status": "agents_status",
};
const ROUTE = /^\/v1\/tenants\/([0-9a-fA-F-]{36})(\/[a-z/_-]+)?$/;
const BUSY_WAIT_MAX_S = 3;

type Part = { ok?: unknown; data?: unknown; error?: { code?: unknown; status?: unknown } | null };
type Answer = { kind: "parts"; parts: Record<string, Part> } | { kind: "busy"; error: ApiRequestError } | { kind: "none" };
type Primed = { tenantId: string; answer: Promise<Answer> };

/** The one place per request that remembers what the layout primed (outside a render `cache` remembers nothing, so a route handler finds nothing and asks its own routes). */
const primed = cache((): { current: Primed | null } => ({ current: null }));

export const bootstrapOn = (): boolean => process.env.BOOTSTRAP === "1";

async function ask(token: string, tenantId: string): Promise<Answer> {
  const path = `/v1/tenants/${tenantId}/bootstrap`;
  for (let again = false; ; again = true) {
    try {
      const body = (await apiRequestOnce(path, token)) as { parts?: unknown } | null;
      const parts = body && typeof body === "object" && body.parts && typeof body.parts === "object" && !Array.isArray(body.parts) ? (body.parts as Record<string, Part>) : null;
      return parts ? { kind: "parts", parts } : { kind: "none" };
    } catch (error) {
      if (error instanceof ApiAuthError) throw error;
      if (isBusy(error)) {
        if (again) return { kind: "busy", error: error as ApiRequestError };
        await new Promise((resolve) => setTimeout(resolve, Math.min((error as ApiRequestError).retryAfter ?? 2, BUSY_WAIT_MAX_S) * 1000));
        continue;
      }
      return { kind: "none" }; // an API without the route (404), unreachable or any other failure: every part asks its own route
    }
  }
}

/** Called by the workspace layout, once per request, before its reads: starts the one request. Does nothing when BOOTSTRAP is off. */
export function primeBootstrap(token: string, tenantId: string): void {
  if (!bootstrapOn()) return;
  const slot = primed();
  if (slot.current === null || slot.current.tenantId !== tenantId) slot.current = { tenantId, answer: ask(token, tenantId) };
  void slot.current.answer.catch(() => undefined); // (a rejected session is thrown to whoever reads a part, not as an unhandled rejection)
}

/**
 * The body of `path` from the bootstrap, or `undefined` when this route is not served from it (not a part, not primed, the part is missing or timed out): the caller then asks the route itself. Throws what the route
 * would have thrown when the part failed.
 */
export async function bootstrapPart(path: string): Promise<{ body: unknown } | undefined> {
  const m = ROUTE.exec(path);
  const name = m ? PARTS[m[2] ?? ""] : undefined;
  const slot = primed().current;
  if (!m || name === undefined || slot === null || slot.tenantId.toLowerCase() !== m[1].toLowerCase()) return undefined;
  const answer = await slot.answer;
  if (answer.kind === "none") return undefined;
  if (answer.kind === "busy") throw answer.error;
  const part = answer.parts[name];
  if (!part || typeof part !== "object") return undefined;
  if (part.ok === true) return part.data === undefined ? undefined : { body: part.data };
  const status = typeof part.error?.status === "number" ? part.error.status : 0;
  const code = typeof part.error?.code === "string" && /^[a-z_]{1,40}$/.test(part.error.code) ? part.error.code : "http_error";
  if (status === 0 || status === 503 || status >= 500) return undefined; // timed out or broken: that one route is asked on its own
  throw refusal(status, { error: { code, message: "Request failed." } });
}
