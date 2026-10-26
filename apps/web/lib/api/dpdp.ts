import { ApiRequestError, apiPublicRequest, apiRequest } from "./client";
import { bad, int, iso, list, oneOf, optIso, optStr, rec, str, word } from "./shape";
import { CONSENT_VIAS, GRIEVANCE_KINDS, MARKETING_STATES, type ConsentVia, type Consents, type GrievanceInput, type GrievanceResult, type PrivacyNotice, type Subprocessors } from "@/lib/dpdp/types";

/**
 * The DPDP part of the API (job DQ part 2; contract-dpdp.md): the public notice facts and the list of companies that process data (no sign-in), the signed-in person's consent record and the one call that gives or withdraws
 * marketing consent, and the public grievance form. Server side only. Every answer is read with the checks of lib/api/shape.ts: what is not the contract's shape is an error, never drawn.
 */
const VERSION = /^[0-9A-Za-z._-]{1,32}$/;
const version = (v: unknown, what: string): string => (typeof v === "string" && VERSION.test(v) ? v : bad(what));
const email = (v: unknown, what: string): string => (typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : bad(what));

export function parseNotice(json: unknown): PrivacyNotice {
  const x = rec(json, "notice");
  const contact = rec(x.contact, "contact");
  const grievance = rec(x.grievance, "grievance");
  const retention = rec(x.retention, "retention");
  return {
    privacyVersion: version(x.privacy_version, "privacy_version"),
    termsVersion: version(x.terms_version, "terms_version"),
    privacyEmail: email(contact.privacy_email, "privacy_email"),
    helloEmail: email(contact.hello_email, "hello_email"),
    grievance: { answerWithinDays: int(grievance.answer_within_days, "answer_within_days", 1, 365) },
    retention: {
      lapsedReadOnlyDays: int(retention.lapsed_read_only_days, "lapsed_read_only_days", 1, 3650),
      erasureWarningHours: int(retention.erasure_warning_hours, "erasure_warning_hours", 1, 1000),
      accountDeletionCancelDays: int(retention.account_deletion_cancel_days, "account_deletion_cancel_days", 1, 365),
      securityLogDays: int(retention.security_log_days, "security_log_days", 1, 3650),
    },
  };
}

const https = (v: unknown, what: string): string | null => {
  const s = optStr(v, what, 300);
  return s !== null && /^https:\/\/[^\s]+$/.test(s) ? s : null;
};

export function parseSubprocessors(json: unknown): Subprocessors {
  const x = rec(json, "subprocessors");
  return {
    version: version(x.version, "version"),
    updatedOn: str(x.updated_on, "updated_on", 20),
    draft: x.wording === "draft",
    items: list(x.subprocessors, "subprocessors", 50).map((row) => {
      const r = rec(row, "subprocessor");
      return { id: word(r.id, "id"), name: str(r.name, "name", 80), purpose: str(r.purpose, "purpose", 300), country: str(r.country, "country", 80), data: str(r.data, "data", 300), link: https(r.link, "link") };
    }),
  };
}

export function parseConsents(json: unknown): Consents {
  const x = rec(json, "consents");
  const marketing = list(x.consents, "consents", 10).map((c) => rec(c, "consent")).find((c) => c.purpose === "marketing");
  if (!marketing) bad("marketing consent");
  return {
    noticeVersion: version(x.notice_version, "notice_version"),
    marketing: { state: oneOf(marketing.state, MARKETING_STATES, "state"), since: optIso(marketing.since, "since") },
    history: list(x.history ?? [], "history", 50).map((h) => {
      const r = rec(h, "history row");
      return { action: oneOf(r.action, ["given", "withdrawn"] as const, "action"), at: iso(r.at, "at"), via: word(r.via, "via"), noticeVersion: version(r.notice_version, "notice_version") };
    }),
  };
}

export async function getPrivacyNotice(): Promise<PrivacyNotice> {
  return parseNotice(await apiPublicRequest("/v1/privacy/notice"));
}
export async function getSubprocessors(): Promise<Subprocessors> {
  return parseSubprocessors(await apiPublicRequest("/v1/privacy/subprocessors"));
}
/** The list again within five minutes is the one already read (the page is drawn for every visitor; the list changes a few times a year). A failed read is not kept. */
let cached: { at: number; value: Subprocessors } | null = null;
export async function subprocessorsCached(now: number = Date.now()): Promise<Subprocessors> {
  if (cached && now - cached.at < 5 * 60_000) return cached.value;
  const value = await getSubprocessors();
  cached = { at: now, value };
  return value;
}
/** For tests: forget the list. */
export const forgetSubprocessors = (): void => {
  cached = null;
};

export async function getMyConsents(token: string): Promise<Consents> {
  return parseConsents(await apiRequest("/v1/me/consents", token));
}
/** Give or withdraw marketing consent: the same one call both ways; repeating the same state changes nothing. */
export async function putMarketingConsent(token: string, given: boolean, via: ConsentVia = "settings"): Promise<Consents> {
  if (!(CONSENT_VIAS as readonly string[]).includes(via)) bad("via");
  return parseConsents(await apiRequest("/v1/me/consents/marketing", token, { method: "PUT", body: JSON.stringify({ given, via }) }));
}

export async function postGrievance(input: GrievanceInput, grievanceId: string): Promise<GrievanceResult> {
  if (!(GRIEVANCE_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: "invalid" };
  try {
    const out = rec(await apiPublicRequest("/v1/privacy/grievance", { method: "POST", body: { grievance_id: grievanceId, name: input.name, contact: input.contact, kind: input.kind, details: input.details, language: input.language, captcha_token: null } }), "grievance");
    const days = int(out.answer_within_days, "answer_within_days", 1, 365);
    const ref = str(out.reference, "reference", 40);
    if (!/^GR-\d{4}-\d{6}$/.test(ref)) bad("reference");
    return { ok: true, reference: ref, answerDueOn: str(out.answer_due_on, "answer_due_on", 12), answerWithinDays: days };
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 429 || error.code === "rate_limited")) return { ok: false, error: "rate" };
    if (error instanceof ApiRequestError && (error.status === 422 || error.status === 400)) return { ok: false, error: "invalid" };
    return { ok: false, error: "down" };
  }
}
