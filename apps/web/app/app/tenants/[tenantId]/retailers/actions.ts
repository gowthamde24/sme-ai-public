"use server";

import { revalidatePath } from "next/cache";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { actOnProspects, approveSearch, cancelSearch, getProspect, getQuoteDraft, getSearch, makeQuoteDraft, planSearch, practiceCall } from "@/lib/api/lead-finder";
import { fetchQuote } from "@/lib/api/quotes";
import { likeThis } from "@/lib/lead-finder/radar";
import { ACTIONS, CALL_LANGUAGES, MAX_BULK, PERSONAS, searchTextProblem, type ActionResult, type CallLanguage, type Persona, type PracticeCall, type ProspectAction, type QuoteDraftMade, type QuoteDraftView, type Search } from "@/lib/lead-finder/types";

/**
 * The changes of the Prospects tab (job lead-finder part D; docs/contracts/lead-finder.md): plan a search from the owner's words, the OK (Owner, Admin) that runs it, Cancel, the bulk buttons, and the practice call (Owner, Admin) IN THE
 * SIMULATOR. Each checks who is asking first (the API checks again), then the input, then asks the API with the person's own token; a refusal comes back in the person's language (`failureOf`), with a sentence of its own for
 * the Lead Finder's codes. Nothing here dials, sends or spends without the Owner's or an Admin's OK: the plan is free, the OK is the search.
 */
import { DECIDERS, invalid, refusal, STAFF, who } from "./finder-guard";

const touch = (tenantId: string) => revalidatePath(`/app/tenants/${tenantId}/retailers`);

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

/**
 * "Find more like this shop" (app v4 part 5): the plan card of a search for this shop's own type, in the area of the search that found it (else the shop's own area). Nothing is searched yet: the plan is free, the OK is the search (Owner and
 * Admin, as for any plan). A shop with no type has nothing to look for.
 */
export async function planLikeThisAction(tenantId: string, prospectId: string): Promise<Reply<Search>> {
  const ctx = await who(tenantId, STAFF);
  if ("ok" in ctx) return ctx;
  if (typeof prospectId !== "string" || !isCanonicalUuid(prospectId)) return invalid(ctx.t);
  const lang = await getLang();
  try {
    const p = await getProspect(ctx.token, tenantId, prospectId);
    const area = p.searchId ? await getSearch(ctx.token, tenantId, p.searchId).then((s) => s.area, () => null) : null;
    const words = likeThis(p, area);
    if (!words || words.area.length < 2) return invalid(ctx.t, "lf.v4.like.none");
    return { ok: true, data: await planSearch(ctx.token, tenantId, { query: words.query, area: words.area }) };
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
    // the preview names the enquiry itself (#305); an older API does not, and then the quote is read once to find it
    let enquiryId: string | null = preview.enquiryId;
    if (preview.made && enquiryId === null) {
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
