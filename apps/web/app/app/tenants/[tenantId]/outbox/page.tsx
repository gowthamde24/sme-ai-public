import { notFound, redirect } from "next/navigation";

import { ApiDownV2 } from "@/components/v2/app/parts";
import type { OutboxActions } from "@/components/v2/app/outbox/OutboxList";
import { OutboxView } from "@/components/v2/app/outbox/OutboxView";
import { isDemoWorkspace } from "@/lib/workspace-demo";
import { TABS, type OutboxTab } from "@/components/v2/app/outbox/reasons";
import { parseFilters } from "@/components/v2/app/outbox/outbox-time";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { appT } from "@/i18n/app";
import { approveFromOutboxAction, dispatchNowAction, outboxDetailAction, editFromOutboxAction, rejectFromOutboxAction } from "./outbox-actions";
import { readOutbox } from "./outbox-data";
import { outboxWords } from "./outbox-words";
import { partsWords } from "@/i18n/app-words";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Outbox · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const MAX_CURSOR = 400;
/** The moment the page is drawn (ms): read once so the day filter and the times agree. */
const clock = (): number => Date.now();

/**
 * /app/tenants/[tenantId]/outbox: every WhatsApp message the shop makes, in four tabs (Waiting for you, Scheduled, Sent, Blocked), with the reason in plain words, a day filter and a customer search. Owner, Admin and Sales
 * read it (the API gives a Viewer a 403, so a Viewer is told so and nothing is read); only Owner and Admin decide, with the second factor for approving. Server side: requireUser() runs first and every call goes to
 * OUR API with the person's own token.
 */
export default async function OutboxPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/outbox">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role === "viewer")
    return (
      <main className={pageMain} lang={lang}>
        <h1 className="font-display text-[26px] font-semibold md:text-4xl">{t("nav.item.outbox")}</h1>
        <p className="mt-3 text-base text-muted">{t("outbox.viewer")}</p>
      </main>
    );
  const wantedTab = pick(query.tab);
  const tab: OutboxTab = (TABS as readonly string[]).includes(wantedTab ?? "") ? (wantedTab as OutboxTab) : "waiting";
  const filters = parseFilters(query, clock());
  const rawAfter = pick(query.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  const now = clock();
  let data;
  try {
    data = await readOutbox(user.accessToken, tenantId, { tab, filters, after, role: tenant.role });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const actions: OutboxActions = {
    approve: approveFromOutboxAction.bind(null, tenantId),
    reject: rejectFromOutboxAction.bind(null, tenantId),
    edit: editFromOutboxAction.bind(null, tenantId),
    dispatch: dispatchNowAction.bind(null, tenantId),
    detail: outboxDetailAction.bind(null, tenantId),
  };
  return (
    <main className={pageMain} lang={lang}>
      <OutboxView demo={isDemoWorkspace(tenant.name)} help={helpTipFor(lang, base, "outbox")} tab={tab} filters={filters} role={tenant.role} now={now} lang={lang} base={base} words={outboxWords(lang)} items={data.items} counts={data.counts} more={data.more} settings={data.settings} scheduler={data.scheduler} actions={actions} />
    </main>
  );
}
