import type { NextRequest } from "next/server";

import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { failureOf, kindOf, type Failure, type FailureKind } from "@/lib/api/failure";
import { submitKyc } from "@/lib/api/phone-kyc";
import { checkBody, clean } from "@/lib/phone-kyc/check";
import { MAX_BODY_BYTES } from "@/lib/phone-kyc/types";

import { failureResponse, guard, json, NO_STORE } from "../data/route-kit";

export const dynamic = "force-dynamic";

/** The codes of the API's refusals that have a sentence of our own (`phkyc.err.<code>`). Anything else is said by its kind (`apierr.*`). */
const OWN = ["kyc_file_too_large", "kyc_file_type", "kyc_file_unreadable", "kyc_not_accepted", "kyc_document_not_offered", "kyc_field_not_supported", "kyc_provider_unavailable", "kyc_unavailable"] as const;
type Own = (typeof OWN)[number];
const isOwn = (code: string): code is Own => (OWN as readonly string[]).includes(code);
const KIND_OF: Record<string, FailureKind> = { kyc_file_too_large: "too_big", kyc_file_type: "invalid", kyc_file_unreadable: "invalid" };

/**
 * POST /app/tenants/[tenantId]/phone-kyc: "Register your business number" (the registration card on the Phone number page). NOT a server action on purpose: a 5 MB file (about 7 MB as base64) is over the server-action body limit, so the browser sends ONE JSON
 * body here and it goes on to the API with the person's own token. Owner only (the API needs the second factor too). Every field and the file's kind and size are checked first. The document passes through in memory: this route never logs, keeps or copies the
 * body, and a refusal never echoes it. The answer is `{ok: true, data}` (where the registration stands now) or `{ok: false, kind, error, code?, reason?}` with `error` already in the person's language.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const guarded = await guard(request, params);
  if (guarded instanceof Response) return guarded;
  const { user, tenantId } = guarded;
  const t = appT(await getLang());
  const refuse = (code: string): Response => {
    const kind: FailureKind = code === "forbidden" ? "forbidden" : (KIND_OF[code] ?? (code === "kyc_unavailable" ? "unavailable" : "invalid"));
    const error = isOwn(code) ? t(`phkyc.err.${code}`) : code.startsWith("field_") ? t("phkyc.err.field") : code === "forbidden" ? t("phkyc.err.not_owner") : t("apierr.invalid");
    return failureResponse({ ok: false, kind, error, code });
  };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse("kyc_file_too_large");
  let parsed: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return refuse("kyc_file_too_large");
    parsed = JSON.parse(text);
  } catch {
    return new Response("Bad request", { status: 400, headers: NO_STORE });
  }
  const checked = checkBody(parsed);
  if (!checked.ok) return checked.code === "bad_body" ? new Response("Bad request", { status: 400, headers: NO_STORE }) : refuse(checked.code);
  try {
    if ((await fetchTenant(user.accessToken, tenantId)).role !== "owner") return refuse("forbidden");
  } catch (error) {
    return error instanceof ApiAuthError ? new Response("Unauthorized", { status: 401, headers: NO_STORE }) : refuse("kyc_unavailable");
  }
  try {
    return json({ ok: true, data: await submitKyc(user.accessToken, tenantId, checked.body) });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: NO_STORE });
    if (error instanceof ApiRequestError && isOwn(error.code)) {
      const reason = error.code === "kyc_not_accepted" ? clean(error.reason ?? "")?.slice(0, 300) : undefined;
      return failureResponse({ ok: false, kind: kindOf(error), error: t(`phkyc.err.${error.code}`), code: error.code, ...(reason ? { reason } : {}) } as Failure);
    }
    try {
      return failureResponse(failureOf(error, t));
    } catch {
      return new Response("Unauthorized", { status: 401, headers: NO_STORE }); // failureOf redirects a rejected session; a fetch gets a plain 401
    }
  }
}
