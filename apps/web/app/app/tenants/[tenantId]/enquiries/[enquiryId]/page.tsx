import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { CHANNEL_LABELS, type Enquiry, type RequirementView, fetchEnquiry, fetchRequirement } from "@/lib/api/enquiries";
import { fetchEnquiryQuotes, fetchQuote, fetchQuoteSetup, fetchQuoteText, type Quote, type QuoteSetup, type QuoteSummary, type QuoteText } from "@/lib/api/quotes";
import { fetchOrders, type Order } from "@/lib/api/orders";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../../local-time";
import { EnquiryText } from "../enquiry-text";
import { QuotePanel } from "../quote-panel";
import { loadWhatsappView, type WhatsappView } from "../whatsapp-view";
import { RequirementPanel } from "../requirement-panel";

export const metadata = { title: "Enquiry · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
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
    return <ApiDown />;
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
  }
  const notice = NOTICES[pick(query.captured) ?? ""];
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}/leads/${enquiry.lead_id}`}>← Lead</Link>
      </p>
      <h1>Enquiry</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      {notice ? (
        <p role="status" className="hint">
          {notice}
        </p>
      ) : null}
      <section aria-labelledby="enquiry-heading">
        <h2 id="enquiry-heading">What the customer wrote</h2>
        <dl className="summary">
          <dt>Channel</dt>
          <dd>{CHANNEL_LABELS[enquiry.channel]}</dd>
          <dt>Received</dt>
          <dd>
            <LocalTime iso={enquiry.received_at} />
          </dd>
          {enquiry.subject ? (
            <>
              <dt>Subject</dt>
              <dd className="plain-text">{enquiry.subject}</dd>
            </>
          ) : null}
        </dl>
        <EnquiryText body={enquiry.body} fields={view.fields} />
        <p className="hint">
          This is the customer&apos;s text, shown as plain text. Contact details were removed before it was saved
          {enquiry.truncated_from ? `; it was cut from ${enquiry.truncated_from} characters` : ""}. Marked words are the ones a field relies on.
        </p>
      </section>
      <RequirementPanel tenantId={tenantId} enquiry={enquiry} view={view} canWrite={WRITE_ROLES.includes(tenant.role)} runId={crypto.randomUUID()} />
      {!canQuote ? (
        <p className="hint">Quotes are shown to owners, admins and sales users.</p>
      ) : quotesDown || setup === null ? (
        <p role="alert" className="error">
          The quote could not be loaded right now. The enquiry above is unaffected: try again shortly.
        </p>
      ) : (
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
        />
      )}
    </main>
  );
}

function ApiDown() {
  return (
    <main className="shell wide">
      <p role="alert" className="error">
        Could not load this from the API. Try again shortly.
      </p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}
