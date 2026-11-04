"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Reply } from "@/components/v2/app/cc/kit";
import { appT, type AppT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { failureOf } from "@/lib/api/failure";
import { actOnProspects, approveSearch, cancelSearch, getQuoteDraft, makeQuoteDraft, planSearch, practiceCall } from "@/lib/api/lead-finder";
import { fetchQuote } from "@/lib/api/quotes";
import { requireUser } from "@/lib/auth/session";
import { ACTIONS, CALL_LANGUAGES, MAX_BULK, PERSONAS, searchTextProblem, type ActionResult, type CallLanguage, type Persona, type PracticeCall, type ProspectAction, type QuoteDraftMade, type QuoteDraftView, type Search } from "@/lib/lead-finder/types";

/**
 * The changes of the Prospects tab (job lead-finder part D; docs/contracts/lead-finder.md): plan a search from the owner's words, the OK (Owner, Admin) that runs it, Cancel, the bulk buttons, and the practice call (Owner, Admin) IN THE
 * SIMULATOR. Each checks who is asking first (the API checks again), then the input, then asks the API with the person's own token; a refusal comes back in the person's language (`failureOf`), with a sentence of its own for
 * the Lead Finder's codes. Nothing here dials, sends or spends without the Owner's or an Admin's OK: the plan is free, the OK is the search.
 */
type Role = "owner" | "admin" | "sales" | "viewer";
const STAFF: readonly Role[] = ["owner", "admin", "sales"];
const DECIDERS: readonly Role[] = ["owner", "admin"];
type Refused = Extract<Reply<never>, { ok: false }>;

async function who(tenantId: string, allowed: readonly Role[]): Promise<{ token: string; t: AppT } | Refused> {
  const user = await requireUser();
  const t = appT(await getLang());
  if (!isCanonicalUuid(tenantId)) return { ok: false, kind: "invalid", error: t("apierr.invalid") };
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (!(allowed as readonly string[]).includes(tenant.role)) return { ok: false, kind: "forbidden", error: t("apierr.forbidden") };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return failureOf(error, t);
  }
  return { token: user.accessToken, t };
}

/** A refusal in our words; the Lead Finder's own codes have sentences of their own. `not_a_search` shows the API's fixed sentence in English (it gives an example of what to say), else ours with the same example. */
function refusal(error: unknown, t: AppT, lang: string): Refused {
  const f = failureOf(error, t);
  const api = error instanceof ApiRequestError ? error : null;
  if (f.code === "not_a_search") return { ...f, error: lang === "en" && api && api.message.length > 0 && api.message.length <= 300 ? api.message : t("lf.err.not_a_search") };
  if (f.code === "search_cap_reached") return { ...f, error: t("lf.err.cap") };
  if (f.code === "lead_finder_off" || f.code === "lead_finder_not_available") return { ...f, error: t("lf.err.off") };
  if (f.code === "nothing_to_quote") return { ...f, error: t("lf.qd.err.nothing") };
  if (f.code === "quote_draft_exists") return { ...f, error: t("lf.qd.err.exists") };
  if (f.code === "not_qualified") return { ...f, error: t("lf.qd.err.not_qualified") };
  return f;
}
const touch = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/retailers`);
const invalid = (t: AppT, key: Parameters<AppT>[0] = "apierr.invalid"): Refused => ({ ok: false, kind: "invalid", error: t(key) });

/** The plan card from the owner's words ("find new retailers in Jayanagar"). Nothing is searched yet. Owner, Admin and Sales. */
export async function planSearchAction(tenantId: string, text: string): Promise<Reply<Search>> {
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return ctx;
  if (typeof text !== "string") return invalid(ctx.t);
  const problem = searchTextProblem(text);
  if (problem) return invalid(ctx.t, problem === "too_long" ? "lf.find.too_long" : "lf.find.empty");
  const lang = await getLang();
  try {
    return { ok: true, data: await planSearch(ctx.token, tenantId, { text, language: lang }) };
  } catch (error) {
    return refusal(error, ctx.t, lang);
  }
}

/** The OK: the search runs there and then (the same OK again is the same result). Owner and Admin. */
export async function approveSearchAction(tenantId: string, searchId: string): Promise<Reply<Search>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof searchId !== "string" || !isCanonicalUuid(searchId)) return invalid(ctx.t);
  try {
    const data = await approveSearch(ctx.token, tenantId, searchId);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    const f = refusal(error, ctx.t, await getLang());
    return f.code === "prospect_state" ? { ...f, error: ctx.t("lf.err.state") } : f;
  }
}

/** Cancel a planned search (Owner and Admin): nothing is searched. */
export async function cancelSearchAction(tenantId: string, searchId: string): Promise<Reply<Search>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof searchId !== "string" || !isCanonicalUuid(searchId)) return invalid(ctx.t);
  try {
    return { ok: true, data: await cancelSearch(ctx.token, tenantId, searchId) };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** A bulk button for the ticked businesses: Call (the Owner's yes), Ask me later, Skip, or, behind the screen's confirm, Not interested / Do not call (suppressed for good). One result per id. */
export async function prospectActionsAction(tenantId: string, ids: string[], action: ProspectAction): Promise<Reply<ActionResult[]>> {
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return ctx;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BULK || !ids.every((i) => typeof i === "string" && isCanonicalUuid(i)) || !(ACTIONS as readonly string[]).includes(action)) return invalid(ctx.t);
  try {
    const data = await actOnProspects(ctx.token, tenantId, [...new Set(ids)], action);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/** The practice call: our assistant against a made-up shopkeeper (`persona`), in English or Telugu. NOTHING IS DIALLED. Owner and Admin; a `call_ready` business only (else the API's 409). */
export async function practiceCallAction(tenantId: string, prospectId: string, persona: Persona, language: CallLanguage): Promise<Reply<PracticeCall>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof prospectId !== "string" || !isCanonicalUuid(prospectId) || !(PERSONAS as readonly string[]).includes(persona) || !(CALL_LANGUAGES as readonly string[]).includes(language)) return invalid(ctx.t);
  try {
    const data = await practiceCall(ctx.token, tenantId, prospectId, persona, language);
    touch(tenantId);
    return { ok: true, data };
  } catch (error) {
    const f = refusal(error, ctx.t, await getLang());
    return f.code === "prospect_state" ? { ...f, error: ctx.t("lf.pc.only") } : f;
  }
}

/**
 * The PREVIEW of the draft quote a qualified call suggests (contract section 7; Owner, Admin and Sales): nothing is stored. Once the draft is made, the enquiry it lives on is looked up (`GET /quotes/{id}`), so "Open the draft quote"
 * goes to that enquiry's page; null when it cannot be read (the screen then opens the list of quotes).
 */
export async function quoteDraftAction(tenantId: string, prospectId: string): Promise<Reply<QuoteDraftView>> {
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return ctx;
  if (typeof prospectId !== "string" || !isCanonicalUuid(prospectId)) return invalid(ctx.t);
  try {
    const preview = await getQuoteDraft(ctx.token, tenantId, prospectId);
    let enquiryId: string | null = null;
    if (preview.made) {
      try {
        const enquiry = (await fetchQuote(ctx.token, tenantId, preview.quoteId)).enquiry_id;
        enquiryId = isCanonicalUuid(enquiry) ? enquiry : null;
      } catch (error) {
        if (error instanceof ApiAuthError) throw error; // a rejected session goes to sign in (below); any other failure leaves the link to the list of quotes
      }
    }
    return { ok: true, data: { ...preview, enquiryId } };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}

/**
 * "Make the draft quote" (Owner and Admin; the API wants the second factor, and a missing one comes back as the way to Security): ONE enquiry on the call's lead and ONE draft quote at the Owner's own catalogue prices. NOTHING is
 * approved or sent: the quote is approved on its enquiry's page like any other. The buyer is a NEW customer (a business the Lead Finder found; one already a customer is never a prospect), and where it is delivered is left to the quote
 * page (no state), where the GST supply is decided.
 */
export async function makeQuoteDraftAction(tenantId: string, prospectId: string): Promise<Reply<QuoteDraftMade>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  if (typeof prospectId !== "string" || !isCanonicalUuid(prospectId)) return invalid(ctx.t);
  try {
    return { ok: true, data: await makeQuoteDraft(ctx.token, tenantId, prospectId, { customerKind: "new", deliveryState: null }) };
  } catch (error) {
    return refusal(error, ctx.t, await getLang());
  }
}
