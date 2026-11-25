import { notFound, redirect } from "next/navigation";

import { CommerceConnectors, bindActions } from "@/components/v2/app/connectors-commerce";
import * as commerceMoves from "@/components/v2/app/connectors-commerce/commerce-actions";
import { ConnectorsView } from "@/components/v2/app/connectors/ConnectorsView";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { getPage, type ConnectorsPage } from "@/lib/api/crm-push";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { loadCommerceData } from "@/lib/api/commerce-notify";
import { listEndpoints } from "@/lib/api/webhooks-out";
import { sampleData } from "@/lib/commerce-notify/sample";
import { SAMPLE_PAGE } from "@/lib/crm-push/sample";
import { crmPushScreens } from "@/lib/screens/flag";
import { requireUser } from "@/lib/auth/session";

import { changeAction, connectAction, disconnectAction, logAction, retryAction, testAction } from "./connectors-actions";

export const metadata = { title: `Connectors · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/connectors (Owner and Admin; CRM_PUSH_SCREENS): where the results of calls and leads can be sent: HubSpot, LeadSquared, Google Sheets and the others, a card each, and the web address card (Zapier, Make, n8n, Pabbly: the
 * outbound webhooks). `mock` draws sample cards with every button off. The API answers 404 while its own switch CRM_PUSH is off: the page then says "not open yet", never a guess.
 */
export default async function ConnectorsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/connectors">) {
  const { tenantId } = await params;
  const { calendar_outlook: back } = await searchParams;
  const outlookResult = typeof back === "string" ? back : null;
  const mode = crmPushScreens();
  if (mode === "off" || !isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  const ui = await getLang();
  const words = wordsFor(ui, ["crm.", "apierr.", "cn."]);
  const developersHref = `/app/tenants/${tenantId}/developers`;
  // below the CRM cards, on the same tab: online stores, messages to the team chat, calendars and lead-form guides (docs/contracts/commerce-notify.md section E). A group whose API switch is off is not drawn.
  const commerce = async () => {
    try {
      const data = await loadCommerceData(user.accessToken, tenantId);
      return <CommerceConnectors words={words} ui={ui} data={data} actions={bindActions(tenantId, commerceMoves)} outlookResult={outlookResult} />;
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  };
  if (mode === "mock") {
    const none = async () => ({ ok: false as const, error: "other" as const });
    return (
      <ConnectorsView words={words} ui={ui} page={SAMPLE_PAGE} readOnly webhooks={{ count: 0 }} developersHref={developersHref} actions={{ connect: none, change: none, disconnect: none, test: none, log: none, retry: none }}>
        <CommerceConnectors words={words} ui={ui} data={sampleData()} actions={bindActions(tenantId, commerceMoves)} readOnly outlookResult={null} />
      </ConnectorsView>
    );
  }
  let page: ConnectorsPage | null = null;
  try {
    page = await getPage(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (!(error instanceof ApiRequestError && error.status === 404)) escalate(error);
  }
  if (page === null) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-6 md:px-8 md:py-6" lang={ui}>
        <h1 className="m-0 font-display text-3xl font-bold">{words["crm.title"]}</h1>
        <p role="note" className="m-0 mt-4 border-y border-line py-3 text-[15px] text-muted">
          {words["crm.off"]}
        </p>
        <div className="mt-6">{await commerce()}</div>
      </main>
    );
  }
  const hooks = await listEndpoints(user.accessToken, tenantId).then((h) => ({ count: h.length })).catch((error) => {
    if (error instanceof ApiAuthError) redirect("/login");
    return null; // WEBHOOKS_OUT off: the card says "not open yet"
  });
  return (
    <ConnectorsView
      words={words}
      ui={ui}
      page={page}
      readOnly={false}
      webhooks={hooks}
      developersHref={developersHref}
      actions={{
        connect: connectAction.bind(null, tenantId),
        change: changeAction.bind(null, tenantId),
        disconnect: disconnectAction.bind(null, tenantId),
        test: testAction.bind(null, tenantId),
        log: logAction.bind(null, tenantId),
        retry: retryAction.bind(null, tenantId),
      }}
    >
      {await commerce()}
    </ConnectorsView>
  );
}
