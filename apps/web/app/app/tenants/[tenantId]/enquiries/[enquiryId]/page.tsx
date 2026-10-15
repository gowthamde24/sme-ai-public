import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { type Enquiry, type RequirementView, fetchEnquiry, fetchRequirement } from "@/lib/api/enquiries";
import { fetchEnquiryQuotes, fetchQuote, fetchQuoteSetup, fetchQuoteText, type Quote, type QuoteSetup, type QuoteSummary, type QuoteText } from "@/lib/api/quotes";
import { fetchOrders, type Order } from "@/lib/api/orders";
import { ApiDownV2, BackLink, SectionTabs } from "@/components/v2/app/parts";
import { alertBox, kvList, mutedText, noteBox, pageH1, pageH2, pageMain, plainText } from "@/components/v2/app/ui";
import { take } from "@/lib/api/settled";
import { requireUser } from "@/lib/auth/session";
import { hasModule } from "@/lib/packs/has";
import { readPackCached } from "@/lib/packs/read";

import { LocalTime } from "../../../../local-time";
import { EnquiryText } from "../enquiry-text";
import { loadManualQuoteData } from "../manual-quote-data";
import { QuotePanel, type ManualQuoteData } from "../quote-panel";
import { recordQuoteSentAction } from "../sent-on-whatsapp-actions";
import { loadWhatsappView, type WhatsappView } from "../whatsapp-view";
import { RequirementPanel } from "../requirement-panel";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Enquiry · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
// Only an owner or an admin may type a price: Sales and Viewer never see the form and the page never asks for its data.
const TYPED_PRICE_ROLES = ["owner", "admin"];
const NOTICE_CODES = ["changed", "truncated", "stored"];

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * /app/tenants/[tenantId]/enquiries/[enquiryId]: the stored text of one enquiry (plain text, the words each field cites marked) beside its
 * requirement. Server-side only; requireUser() runs FIRST and every call goes to OUR API with the user's own token. A tenant or enquiry that
 * does not exist, is malformed or belongs to someone else produces the SAME not-found page.
 */
export default async function EnquiryPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/enquiries/[enquiryId]">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["enq.", "orders.", "fu.", "qp.", "mat.", "today.err.", "today.lang."], ["gst.customer", "gst.ours", "today.act.working", "today.act.cancel", "site.customer.unknown", "frame.notyet", "nav.item.quotes", "nav.item.sites", "catalogue.photo.none"]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId, enquiryId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(enquiryId)) notFound();

  let tenant;
  let enquiry: Enquiry;
  let view: RequirementView;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId); // first: nothing else is asked about a workspace the person cannot see
    // the enquiry and its requirement do not depend on each other: asked at the same time (job CH)
    const [enquiryRead, requirementRead] = await Promise.allSettled([fetchEnquiry(user.accessToken, tenantId, enquiryId), fetchRequirement(user.accessToken, tenantId, enquiryId)]);
    enquiry = take(enquiryRead);
    view = take(requirementRead);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  // A business that sells by area, weight or piece (module `materials`, job CO) quotes with the building-materials engine; everything about saree quotes below is then left alone.
  const materials = hasModule(await readPackCached(user.accessToken, tenantId).catch(() => null), "materials");
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
  let manualRead: Promise<ManualQuoteData> | null = null;
  if (canQuote && !materials) {
    try {
      [setup, quotes] = await Promise.all([fetchQuoteSetup(user.accessToken, tenantId, enquiryId), fetchEnquiryQuotes(user.accessToken, tenantId, enquiryId)]);
      // the typed-price form's data needs only the setup, so it is read while the chosen quote is (job CH); its own failure is handled after, as before. The no-op catch only keeps an early exit from leaving an unhandled rejection.
      if (setup && TYPED_PRICE_ROLES.includes(tenant.role)) {
        manualRead = loadManualQuoteData(user.accessToken, tenantId, setup.today, crypto.randomUUID());
        manualRead.catch(() => undefined);
      }
      const wanted = pick(query.quote);
      const chosen = wanted && isCanonicalUuid(wanted) && quotes.some((q) => q.id === wanted) ? wanted : quotes[0]?.id;
      selected = chosen ? await fetchQuote(user.accessToken, tenantId, chosen) : null;
      if (selected?.outcome === "approved") {
        // the order and the customer's text do not depend on each other: asked at the same time (job CH)
        const [orderRead, textRead] = await Promise.allSettled([fetchOrders(user.accessToken, tenantId, { quoteId: selected.id, limit: 1 }), fetchQuoteText(user.accessToken, tenantId, selected.id)]);
        try {
          // the order already started from this quote (if any): a nicety, the quote screen never depends on it
          order = take(orderRead).items[0] ?? null;
        } catch (error) {
          if (error instanceof ApiAuthError) redirect("/login");
        }
        try {
          text = take(textRead);
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
    if (manualRead) {
      try {
        manual = await manualRead;
      } catch (error) {
        if (error instanceof ApiAuthError) redirect("/login");
        manual = { unavailable: true }; // the rest of the quote screen does not depend on it
      }
    }
  }
  const captured = pick(query.captured) ?? "";
  const notice = NOTICE_CODES.includes(captured) ? t(`enq.notice.${captured}`) : undefined;
  // One part of the screen at a time: the request, making a quote, the quote made, and (once a quote is approved) what to do with it. Where the work is decides the first part.
  const canSend = canQuote && selected?.outcome === "approved";
  const canView = canQuote && selected !== null;
  const canMake = canQuote && setup !== null;
  const wanted = pick(query.section);
  if (materials) return MaterialEnquiry({ t, words, lang, tenant, tenantId, enquiry, enquiryId, view, notice, canQuote });
  // `?section=all` draws every part on one page (the way the screen was before it was split, for printing and for the tests that pin the whole screen).
  const section: "all" | "request" | "make" | "view" | "send" =
    wanted === "all" ? "all" : wanted === "send" && canSend ? "send" : wanted === "view" && canView ? "view" : wanted === "make" && canMake ? "make" : wanted === "request" ? "request" : pick(query.whatsapp) && canSend ? "send" : canView ? "view" : "request";
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  const keep = pick(query.quote) && selected ? `&quote=${selected.id}` : "";
  const parts = [
    { key: "request", label: t("enq.part.request"), href: `${base}?section=request`, current: section === "request" },
    ...(canMake ? [{ key: "make", label: t("enq.part.make"), href: `${base}?section=make`, current: section === "make" }] : []),
    ...(canView ? [{ key: "view", label: t("enq.part.view"), href: `${base}?section=view${keep}`, current: section === "view" }] : []),
    ...(canSend ? [{ key: "send", label: t("enq.part.send"), href: `${base}?section=send${keep}`, current: section === "send" }] : []),
  ];
  const quoteProblem =
    canQuote && (quotesDown || setup === null) ? (
      <p role="alert" className={alertBox}>
        {t("enq.the_quote_could_not_be_loaded")}
      </p>
    ) : null;
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/quotes`} label={t("enq.all_quotes")} then={{ href: `/app/tenants/${tenantId}/leads/${enquiry.lead_id}`, label: t("enq.the_lead") }} />
      <h1 className={pageH1}>{t("enq.enquiry")}</h1>
      {notice ? (
        <p role="status" className={noteBox}>
          {notice}
        </p>
      ) : null}
      {parts.length > 1 && section !== "all" ? <SectionTabs label={t("enq.parts_of_this_enquiry")} items={parts} /> : null}
      {section === "request" || section === "all" ? (
        <>
        <section aria-labelledby="enquiry-heading">
          <h2 id="enquiry-heading" className={pageH2}>
            {t("enq.what_the_customer_wrote")}
          </h2>
          <dl className={kvList}>
            <dt>{t("enq.channel")}</dt>
            <dd>{t(`enq.channel.${enquiry.channel}`)}</dd>
            <dt>{t("enq.received")}</dt>
            <dd>
              <LocalTime iso={enquiry.received_at} />
            </dd>
            {enquiry.subject ? (
              <>
                <dt>{t("enq.subject")}</dt>
                <dd className={plainText}>{enquiry.subject}</dd>
              </>
            ) : null}
          </dl>
          <EnquiryText words={words} body={enquiry.body} fields={view.fields} />
          <p className={mutedText}>
            {t("enq.customer_text_note", { cut: enquiry.truncated_from ? t("enq.cut_from", { n: enquiry.truncated_from }) : "" })}
          </p>
        </section>
          <RequirementPanel words={words} tenantId={tenantId} enquiry={enquiry} view={view} canWrite={WRITE_ROLES.includes(tenant.role)} runId={crypto.randomUUID()} />
          {!canQuote ? <p className={mutedText}>{t("enq.quotes_are_shown_to_owners_admins")}</p> : quoteProblem}
        </>
      ) : null}
      {section === "request" ? null : quoteProblem && section !== "all" ? (
        quoteProblem
      ) : setup !== null ? (
        <QuotePanel words={words}
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

/**
 * The enquiry of a business that sells building materials (job CO): the customer's words and the requirement as before (with the vocabulary of area, thickness and site), then "Quote": the builder and the quotes made.
 * The saree quote parts are not drawn.
 */
function MaterialEnquiry({ t, words, lang, tenant, tenantId, enquiry, enquiryId, view, notice, canQuote }: { t: ReturnType<typeof makeT>; words: Record<string, string>; lang: string; tenant: { role: "owner" | "admin" | "sales" | "viewer" }; tenantId: string; enquiry: Enquiry; enquiryId: string; view: RequirementView; notice: string | undefined; canQuote: boolean }) {
  const base = `/app/tenants/${tenantId}/enquiries/${enquiryId}`;
  const parts = [
    { key: "request", label: t("enq.part.request"), href: base, current: true },
    ...(canQuote ? [{ key: "quote", label: t("mat.part.quote"), href: `${base}/quote`, current: false }] : []),
  ];
  return (
    <main className={pageMain} lang={lang}>
      <BackLink href={`/app/tenants/${tenantId}/quotes`} label={t("enq.all_quotes")} then={{ href: `/app/tenants/${tenantId}/leads/${enquiry.lead_id}`, label: t("enq.the_lead") }} />
      <h1 className={pageH1}>{t("enq.enquiry")}</h1>
      {notice ? (
        <p role="status" className={noteBox}>
          {notice}
        </p>
      ) : null}
      {parts.length > 1 ? <SectionTabs label={t("enq.parts_of_this_enquiry")} items={parts} /> : null}
      <>
          <section aria-labelledby="enquiry-heading">
            <h2 id="enquiry-heading" className={pageH2}>
              {t("enq.what_the_customer_wrote")}
            </h2>
            <dl className={kvList}>
              <dt>{t("enq.channel")}</dt>
              <dd>{t(`enq.channel.${enquiry.channel}`)}</dd>
              <dt>{t("enq.received")}</dt>
              <dd>
                <LocalTime iso={enquiry.received_at} />
              </dd>
              {enquiry.subject ? (
                <>
                  <dt>{t("enq.subject")}</dt>
                  <dd className={plainText}>{enquiry.subject}</dd>
                </>
              ) : null}
            </dl>
            <EnquiryText words={words} body={enquiry.body} fields={view.fields} />
            <p className={mutedText}>{t("enq.customer_text_note", { cut: enquiry.truncated_from ? t("enq.cut_from", { n: enquiry.truncated_from }) : "" })}</p>
          </section>
          <RequirementPanel words={words} tenantId={tenantId} enquiry={enquiry} view={view} canWrite={WRITE_ROLES.includes(tenant.role)} runId={crypto.randomUUID()} materials />
          {!canQuote ? <p className={mutedText}>{t("enq.quotes_are_shown_to_owners_admins")}</p> : null}
      </>
    </main>
  );
}
