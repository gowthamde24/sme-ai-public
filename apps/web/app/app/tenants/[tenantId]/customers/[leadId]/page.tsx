import { notFound, redirect } from "next/navigation";

import { CustomerView, type CustomerFilter } from "@/components/v2/app/customer/CustomerView";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchCompany, isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { fetchCustomerHead, fetchTimeline, type TimelinePage } from "@/lib/api/customer-timeline";
import { fetchLeadFollowup } from "@/lib/api/followups";
import { getMarketingConsent } from "@/lib/api/marketing-consent";
import { requireUser } from "@/lib/auth/session";
import { appV4, offerScreens } from "@/lib/screens/flag";

import { previewConsentAskAction, sendConsentAskAction } from "./consent-ask-actions";
import { asFilter, businessName, consentView, customerStatus, customerWants, mainAction, sourceWords, timelineHref, waitingQuote } from "./customer-logic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const clock = (): number => Date.now();

/**
 * One page per customer (app v4 part 3; only with APP_V4, else 404): who they are, everything that happened with them (C1's `GET /customers/{lead_id}/timeline`, newest first, 50 at a time), what they want (the lead's
 * profile) and what's next (the follow-up engine's decision), with ONE main button. The lead is read first (nothing else is asked about a lead the person cannot see); the rest at the same time, each part failing on its own.
 */
export default async function CustomerPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/customers/[leadId]">) {
  if (!appV4()) notFound();
  const user = await requireUser();
  const { tenantId, leadId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(leadId)) notFound();
  const query = await searchParams;
  const rawBefore = pick(query.before);
  const before = rawBefore && rawBefore.length <= 40 && !Number.isNaN(Date.parse(rawBefore)) ? rawBefore : null;
  const filter: CustomerFilter = asFilter(pick(query.kind));
  let lead;
  try {
    lead = await fetchCustomerHead(user.accessToken, tenantId, leadId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  // who is asking: only the Owner and Admin may ask a customer for consent (the API checks again); a workspace that cannot be read draws no button
  const roleAsked = offerScreens() !== "off" ? fetchTenant(user.accessToken, tenantId).then((x) => x.role).catch(() => null) : Promise.resolve(null);
  const [timelineRead, companyRead, followupRead, consentRead] = await Promise.allSettled([
    fetchTimeline(user.accessToken, tenantId, leadId, before),
    lead.companyId && isCanonicalUuid(lead.companyId) ? fetchCompany(user.accessToken, tenantId, lead.companyId) : Promise.resolve(null),
    fetchLeadFollowup(user.accessToken, tenantId, leadId),
    // the consent to offers (OFFER_SCREENS; Owner, Admin and Sales may read it: a refusal, or a customer with no contact, draws no chip)
    offerScreens() !== "off" && lead.contactId && isCanonicalUuid(lead.contactId) ? getMarketingConsent(user.accessToken, tenantId, lead.contactId) : Promise.resolve(null),
  ]);
  if ([timelineRead, companyRead, followupRead, consentRead].some((r) => r.status === "rejected" && r.reason instanceof ApiAuthError)) redirect("/login");
  const page: TimelinePage | null = timelineRead.status === "fulfilled" ? timelineRead.value : null;
  const company = companyRead.status === "fulfilled" ? companyRead.value : null;
  const decision = followupRead.status === "fulfilled" ? followupRead.value.decision : null;

  const lang = await getLang();
  const w = wordsFor(lang, ["cust.v4.", "ld.source.", "mc.via."]);
  const role = await roleAsked;
  // "Ask for consent": Owner and Admin, a customer not asked about offers yet (a customer who agreed or stopped gets no button); tapping only previews, "Send ask" is the approval
  const ask = (role === "owner" || role === "admin") && consentRead.status === "fulfilled" && consentRead.value?.state === "unknown" ? { words: wordsFor(lang, ["consent.ask."]), preview: previewConsentAskAction.bind(null, tenantId, leadId), send: sendConsentAskAction.bind(null, tenantId, leadId) } : null;
  const when = (iso: string) => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const base = `/app/tenants/${tenantId}`;
  const here = `${base}/customers/${leadId}`;
  const profile = lead.profile;
  let language: string | null = null;
  if (lead.language) {
    try {
      language = new Intl.DisplayNames([lang], { type: "language" }).of(lead.language) ?? null;
    } catch {
      language = null;
    }
  }
  const source = sourceWords(lead.source, w);
  const items = page?.items ?? null;
  const quoteId = before ? null : waitingQuote(items); // only the newest page knows what is waiting now
  const action = decision?.action ?? null;
  const next = action === "draft_followup" || (action === "wait" && decision?.next_eligible_at) ? { what: w["cust.v4.next.followup"], when: action === "wait" && decision?.next_eligible_at ? when(decision.next_eligible_at) : null } : null;
  const withQuery = (q: Record<string, string | null>) => {
    const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => e[1] !== null)).toString();
    return s ? `${here}?${s}` : here;
  };
  return (
    <main className={pageMain} lang={lang}>
      <CustomerView
        name={lead.name}
        business={businessName(company?.name)}
        language={language}
        source={source}
        status={customerStatus({ items, urgency: profile?.urgency, leadStatus: lead.status, now: clock() }, w)}
        want={customerWants(profile, w)}
        next={next}
        main={mainAction({ base, leadId, quoteId, followupDue: action === "draft_followup" }, w)}
        ask={ask}
        consent={consentRead.status === "fulfilled" && consentRead.value ? consentView(consentRead.value, w, when) : null}
        items={items}
        filter={filter}
        filterHref={(f) => withQuery({ kind: f === "all" ? null : f, before })}
        olderHref={page?.nextBefore ? withQuery({ kind: filter === "all" ? null : filter, before: page.nextBefore }) : null}
        itemHref={(i) => timelineHref(base, i)}
        when={when}
        w={w}
      />
    </main>
  );
}
