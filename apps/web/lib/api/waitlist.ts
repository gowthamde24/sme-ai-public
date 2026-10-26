import { ApiContractError, ApiRequestError, apiPublicRequest } from "./client";
import type { WaitlistInput, WaitlistResult } from "@/lib/waitlist/types";

/**
 * The public site's "book a demo / join the waitlist" (job DQ; contract-dpdp.md, section 1), server side only and without a sign-in. The notice version is the one the visitor saw (`GET /v1/privacy/notice`); the API stores the consent,
 * given or not, with it and the time. The same contact again is answered like the first time (the API never says which), so the thank-you is the same.
 */
type Notice = { privacy_version: string };

function readNotice(json: unknown): Notice {
  const v = typeof json === "object" && json !== null ? (json as Record<string, unknown>).privacy_version : null;
  if (typeof v !== "string" || !/^[0-9A-Za-z._-]{1,32}$/.test(v)) throw new ApiContractError("Unexpected /v1/privacy/notice response.");
  return { privacy_version: v };
}

export const getNoticeVersion = async (): Promise<string> => readNotice(await apiPublicRequest("/v1/privacy/notice")).privacy_version;

export function waitlistBody(v: WaitlistInput, noticeVersion: string): Record<string, unknown> {
  return { name: v.name, business_type: v.businessType, city: v.city, phone: v.phone, email: v.email, language: v.language, marketing_opt_in: v.marketingOptIn, notice_version: noticeVersion, captcha_token: null };
}

export async function postWaitlist(v: WaitlistInput): Promise<WaitlistResult> {
  try {
    const body = waitlistBody(v, await getNoticeVersion());
    const out = await apiPublicRequest("/v1/public/waitlist", { method: "POST", body });
    const status = typeof out === "object" && out !== null ? (out as Record<string, unknown>).status : null;
    return status === "joined" || status === "already_joined" ? { ok: true } : { ok: false, error: "down" };
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 429 || error.code === "rate_limited")) return { ok: false, error: "rate" };
    if (error instanceof ApiRequestError && error.status === 422) return { ok: false, error: "invalid" };
    return { ok: false, error: "down" };
  }
}
