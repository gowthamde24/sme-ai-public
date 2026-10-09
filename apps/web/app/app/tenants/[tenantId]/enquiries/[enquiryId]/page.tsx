import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { CHANNEL_LABELS, type Enquiry, type RequirementView, fetchEnquiry, fetchRequirement } from "@/lib/api/enquiries";
import { fetchEnquiryQuotes, fetchQuote, fetchQuoteSetup, fetchQuoteText, type Quote, type QuoteSetup, type QuoteSummary, type QuoteText } from "@/lib/api/quotes";
import { fetchOrders, type Order } from "@/lib/api/orders";
import { ApiDownV2, SectionTabs } from "@/components/v2/app/parts";
import { alertBox, backLink, kvList, mutedText, noteBox, pageH1, pageH2, pageMain, plainText } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../../local-time";
import { EnquiryText } from "../enquiry-text";
import { loadManualQuoteData } from "../manual-quote-data";
import { QuotePanel, type ManualQuoteData } from "../quote-panel";
import { recordQuoteSentAction } from "../sent-on-whatsapp-actions";
import { loadWhatsappView, type WhatsappView } from "../whatsapp-view";
import { RequirementPanel } from "../requirement-panel";

export const metadata = { title: "Enquiry · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
// Only an owner or an admin may type a price: Sales and Viewer never see the form and the page never asks for its data.
const TYPED_PRICE_ROLES = ["owner", "admin"];
const NOTICES: Record<string, string> = {
  changed: "Saved. Contact details and hidden characters were removed from the text before it was saved; the original is not kept.",
  truncated: "Saved. The text was longer than 6,000 characters and was cut (contact details and hidden characters were removed too).",
  stored: "Saved.",
};

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/enquiries/[enquiryId]: the stored text of one enquiry (plain text, the words each field cites marked) beside its
 * requirement. Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token. A tenant or enquiry that
 * does not exist, is malformed or belongs to someone else produces the SAME not-found page.
 */
export default async function EnquiryPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/enquiries/[enquiryId]">) {
  const user = await requireUser();
  const { tenantId, enquiryId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) notFound();

  let tenant;
  let enquiry: Enquiry;
  let view: RequirementView;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
    enquiry = await fetchEnquiry(user.accessToken, tenantId, enquiryId);
    view = await fetchRequirement(user.accessToken, tenantId, enquiryId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
  }
  // A Viewer reads no price and no quote (the API refuses them), so nothing is asked for them. A quote screen that cannot load does not take the enquiry down.
  const canQuote = WRITE_ROLES.includes(tenant.role);
  let setup: QuoteSetup | null = null;
  let quotes: QuoteSummary[] = [];
  let selected: Quote | null = null;
  let text: QuoteText | null = null;
  let textError: string | null = null;
  let whatsapp: WhatsappView | null = null;
  let quotesDown = false;
  let order: Order | null = null;
  let manual: ManualQuoteData | null = null;
  if (canQuote) {
    try {
      [setup, quotes] = await Promise.all([fetchQuoteSetup(user.accessToken, tenantId, enquiryId), fetchEnquiryQuotes(user.accessToken, tenantId, enquiryId)]);
      const wanted = pick(query.quote);
      const chosen = wanted && isCanonicalUuid(wanted) && quotes.some((q) => q.id === wanted) ? wanted : quotes[0]?.id;
      selected = chosen ? await fetchQuote(user.accessToken, tenantId, chosen) : null;
      if (selected?.outcome === "approved") {
        try {
          // the order already started from this quote (if any): a nicety, the quote screen never depends on it
          order = (await fetchOrders(user.accessToken, tenantId, { quoteId: selected.id, limit: 1 })).items[0] ?? null;
        } catch (error) {
          if (error instanceof ApiAuthError) redirect("/login");
        }
        try {
          text = await fetchQuoteText(user.accessToken, tenantId, selected.id);
        } catch (error) {
          if (error instanceof ApiAuthError) redirect("/login");
          textError = error instanceof ApiRequestError ? error.code : "unavailable";
        }
        if (text) whatsapp = await loadWhatsappView(user.accessToken, tenantId, selected, text, query.whatsapp, new Date());
      }
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      quotesDown = true;
    }
    if (setup && TYPED_PRICE_ROLES.includes(tenant.role)) {
      try {
        manual = await loadManualQuoteData(user.accessToken, tenantId, setup.today, crypto.randomUUID());
      } catch (error) {
        if (error instanceof ApiAuthError) redirect("/login");
        manual = { unavailable: true }; // the rest of the quote screen does not depend on it
      }
    }
  }
  const notice = NOTICES[pick(query.captured) ?? ""];
  // One part of the screen at a time: the request, making a quote, the quote made, and (once a quote is approved) what to do with it. Where the work is decides the first part.
  const canSend = canQuote && selected?.outcome === "approved";
  const canView = canQuote && selected !== null;
  const canMake = canQuote && setup !== null;
  const wanted = pick(query.section);
  // `?section=all` draws every part on one page (the way the screen was before it was split, for printing and for the tests that pin the whole screen).
  const section: "all" | "request" | "make" | "view" | "send" =
    wanted === "all" ? "all" : wanted === "send" && canSend ? "send" : wanted === "view" && canView ? "view" : wanted === "make" && canMake ? "make" : wanted === "request" ? "request" : pick(query.whatsapp) && canSend ? "send" : canView ? "view" : "request";
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  const keep = pick(query.quote) && selected ? `&quote=${selected.id}` : "";
  const parts = [
    { key: "request", label: "Request", href: `${base}?section=request`, current: section === "request" },
    ...(canMake ? [{ key: "make", label: "Make a quote", href: `${base}?section=make`, current: section === "make" }] : []),
    ...(canView ? [{ key: "view", label: "Quote", href: `${base}?section=view${keep}`, current: section === "view" }] : []),
    ...(canSend ? [{ key: "send", label: "Send and order", href: `${base}?section=send${keep}`, current: section === "send" }] : []),
  ];
  const quoteProblem =
    canQuote && (quotesDown || setup === null) ? (
      <p role="alert" className={alertBox}>
        The quote could not be loaded right now. The enquiry above is unaffected: try again shortly.
      </p>
    ) : null;
  return (
    <main className={pageMain}>
      <p>
        <Link href={`/app/tenants/${tenantId}/leads/${enquiry.lead_id}`} className={backLink}>
          ← Lead
        </Link>
      </p>
      <h1 className={pageH1}>Enquiry</h1>
      {notice ? (
        <p role="status" className={noteBox}>
          {notice}
        </p>
      ) : null}
      {parts.length > 1 && section !== "all" ? <SectionTabs label="Parts of this enquiry" items={parts} /> : null}
      {section === "request" || section === "all" ? (
        <>
        <section aria-labelledby="enquiry-heading">
          <h2 id="enquiry-heading" className={pageH2}>
            What the customer wrote
          </h2>
          <dl className={kvList}>
            <dt>Channel</dt>
            <dd>{CHANNEL_LABELS[enquiry.channel]}</dd>
            <dt>Received</dt>
            <dd>
              <LocalTime iso={enquiry.received_at} />
            </dd>
            {enquiry.subject ? (
              <>
                <dt>Subject</dt>
                <dd className={plainText}>{enquiry.subject}</dd>
              </>
            ) : null}
          </dl>
          <EnquiryText body={enquiry.body} fields={view.fields} />
          <p className={mutedText}>
            This is the customer&apos;s text, shown as plain text. Contact details were removed before it was saved
            {enquiry.truncated_from ? `; it was cut from ${enquiry.truncated_from} characters` : ""}. Marked words are the ones a field relies on.
          </p>
        </section>
          <RequirementPanel tenantId={tenantId} enquiry={enquiry} view={view} canWrite={WRITE_ROLES.includes(tenant.role)} runId={crypto.randomUUID()} />
          {!canQuote ? <p className={mutedText}>Quotes are shown to owners, admins and sales users.</p> : quoteProblem}
        </>
      ) : null}
      {section === "request" ? null : quoteProblem && section !== "all" ? (
        quoteProblem
      ) : setup !== null ? (
        <QuotePanel
          tenantId={tenantId}
          enquiryId={enquiryId}
          role={tenant.role}
          secondFactorMissing={user.aal !== "aal2"}
          setup={setup}
          quotes={quotes}
          selected={selected}
          text={text}
          textError={textError}
          newQuoteId={crypto.randomUUID()}
          order={order}
          newOrderId={crypto.randomUUID()}
          whatsapp={whatsapp}
          sentOnWhatsapp={selected ? { action: recordQuoteSentAction.bind(null, tenantId, selected.id), touchId: crypto.randomUUID() } : null}
          manual={manual}
          part={section === "all" ? undefined : section}
        />
      ) : null}
    </main>
  );
}
