import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import { ApprovalPanel } from "@/components/v2/app/campaigns/ApprovalPanel";
import { AudiencePanel } from "@/components/v2/app/campaigns/AudiencePanel";
import { CampaignControls } from "@/components/v2/app/campaigns/CampaignControls";
import { CampaignForm } from "@/components/v2/app/campaigns/CampaignForm";
import { CampaignHub, TABS, type Tab } from "@/components/v2/app/campaigns/CampaignHub";
import { CampaignOverview } from "@/components/v2/app/campaigns/CampaignOverview";
import { CampaignsView } from "@/components/v2/app/campaigns/CampaignsView";
import { CallList } from "@/components/v2/app/campaigns/CallList";
import { kindsFor } from "@/components/v2/app/campaigns/campaign-logic";
import { ResultsView } from "@/components/v2/app/campaigns/ResultsView";
import { todayInIndia } from "@/components/v2/app/visits/dates";
import { pageMain } from "@/components/v2/app/ui";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { getCallList, getCampaign, getPreview, getResults, listCampaigns, listRecipients } from "@/lib/api/campaigns";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { listProgrammes } from "@/lib/api/education";
import { listTemplates } from "@/lib/api/whatsapp";
import { clock } from "@/lib/clock";
import { hasModule } from "@/lib/packs/has";

import { addFromLedgerAction, announceAudienceAction, approveCampaignAction, callOutcomeAction, campaignStateAction, clearRecipientsAction, connectCallAction, importRecipientsAction, removeRecipientAction, saveCampaignAction } from "./actions";
import { campaignWords } from "./campaign-words";
import type { CampaignContext } from "./prelude";

type Raw = Record<string, string | string[] | undefined>;
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE = 50;
const MAX_CURSOR = 400;
const ANNOUNCE_KINDS: readonly string[] = ["event", "exam", "holiday"];

const money = (kind: string) => kind === "payment_due" || kind === "fee_due";

const signedOut = (error: unknown): never => {
  if (error instanceof ApiAuthError) redirect("/login");
  escalate(error);
  throw error;
};

/** The list of campaigns. */
export async function CampaignsListPage({ accessToken, tenantId, tenant, raw, announcements = false }: CampaignContext & { raw: Raw; announcements?: boolean }) {
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const rawAfter = pick(raw.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  let page: Awaited<ReturnType<typeof listCampaigns>> | null = null;
  try {
    page = await listCampaigns(accessToken, tenantId, { after });
    if (announcements) page = { ...page, items: page.items.filter((c) => ANNOUNCE_KINDS.includes(c.kind)) };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  return (
    <main className={pageMain} lang={lang}>
      <CampaignsView base={base} words={campaignWords(lang)} role={tenant.role} campaigns={page?.items ?? null} more={page?.next_cursor ? `${base}/${announcements ? "announcements" : "campaigns"}?after=${encodeURIComponent(page.next_cursor)}` : null} saved={pick(raw.saved) === "1"} announcements={announcements} />
    </main>
  );
}

async function templatesFor(ctx: CampaignContext) {
  try {
    return (await listTemplates(ctx.accessToken, ctx.tenantId)).filter((t) => t.status === "approved" && t.purpose === "reminder").map((t) => ({ id: t.id, name: t.name, language: t.language }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return [];
  }
}

/** The form to make a campaign (campaignId = null) or change one. The page makes the id of a new one, so pressing Save twice is a retry. */
export async function CampaignFormPage(ctx: CampaignContext & { campaignId: string | null; announcements?: boolean }) {
  const { accessToken, tenantId, pack } = ctx;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const kinds = kindsFor(pack?.modules ?? []).filter((k) => !ctx.announcements || ANNOUNCE_KINDS.includes(k));
  if (kinds.length === 0) notFound();
  let campaign = null;
  if (ctx.campaignId) {
    try {
      campaign = await getCampaign(accessToken, tenantId, ctx.campaignId);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) notFound();
      signedOut(error);
    }
    if (campaign && campaign.status !== "draft" && campaign.status !== "approved") redirect(`${base}/campaigns/${campaign.id}`);
  }
  const id = ctx.campaignId ?? randomUUID();
  const templates = await templatesFor(ctx);
  return (
    <main className={pageMain} lang={lang}>
      <h1 className="mb-4 font-display text-[26px] font-semibold leading-[1.15] md:text-4xl">{campaignWords(lang)[campaign ? "camp.edit.title" : ctx.announcements ? "camp.ann.add" : "camp.new.title"]}</h1>
      <CampaignForm base={base} campaignId={id} campaign={campaign} kinds={kinds} templates={templates} words={campaignWords(lang)} actions={{ save: saveCampaignAction.bind(null, tenantId) }} {...(ctx.announcements ? { afterTab: "audience" } : {})} />
    </main>
  );
}

/** One campaign: overview, audience, check and approve, results. */
export async function CampaignPage({ accessToken, tenantId, tenant, pack, campaignId, raw }: CampaignContext & { campaignId: string; raw: Raw }) {
  if (!isCanonicalUuid(campaignId)) notFound();
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const words = campaignWords(lang);
  const wanted = pick(raw.tab);
  const tab: Tab = (TABS as readonly (string | undefined)[]).includes(wanted) ? (wanted as Tab) : "overview";
  const admin = tenant.role === "owner" || tenant.role === "admin";
  let campaign;
  try {
    campaign = await getCampaign(accessToken, tenantId, campaignId);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return signedOut(error);
  }
  const canEdit = campaign.status === "draft" || campaign.status === "approved";
  type Data = { tab: "overview" } | { tab: "audience"; rows: Awaited<ReturnType<typeof listRecipients>>; programmes: Awaited<ReturnType<typeof listProgrammes>> } | { tab: "approve"; preview: Awaited<ReturnType<typeof getPreview>> } | { tab: "results"; results: Awaited<ReturnType<typeof getResults>> };
  let data: Data | null;
  try {
    if (tab === "overview") {
      data = { tab };
    } else if (tab === "audience") {
      const rawAfter = Number(pick(raw.after));
      const after = Number.isInteger(rawAfter) && rawAfter > 0 ? rawAfter : undefined;
      const school = hasModule(pack, "programmes");
      data = {
        tab,
        rows: await listRecipients(accessToken, tenantId, campaignId, { limit: PAGE, ...(after !== undefined ? { after } : {}) }),
        programmes: school && !money(campaign.kind) ? await listProgrammes(accessToken, tenantId).catch((e) => { if (e instanceof ApiAuthError) throw e; return []; }) : [],
      };
    } else if (tab === "approve") {
      data = { tab, preview: await getPreview(accessToken, tenantId, campaignId) };
    } else {
      data = { tab, results: await getResults(accessToken, tenantId, campaignId) };
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    data = null;
  }
  const last = data?.tab === "audience" ? data.rows[data.rows.length - 1] : undefined;
  const body =
    data === null ? (
      <p role="alert" className="rounded-2xl border border-line p-4 text-base">{words["camp.loaderr"]}</p>
    ) : data.tab === "overview" ? (
      <CampaignOverview base={base} campaign={campaign} words={words} canEdit={canEdit} />
    ) : data.tab === "audience" ? (
      <AudiencePanel
        status={campaign.status}
        money={money(campaign.kind)}
        fromLedger={hasModule(pack, "dues") || hasModule(pack, "fees")}
        studentParty={hasModule(pack, "programmes") && money(campaign.kind)}
        programmes={data.programmes}
        recipients={data.rows}
        total={campaign.recipients}
        words={words}
        canEdit={canEdit}
        moreHref={last && data.rows.length === PAGE ? `${base}/campaigns/${campaignId}?tab=audience&after=${last.seq}` : null}
        actions={{
          fromLedger: addFromLedgerAction.bind(null, tenantId, campaignId),
          importList: importRecipientsAction.bind(null, tenantId, campaignId),
          clear: clearRecipientsAction.bind(null, tenantId, campaignId),
          remove: removeRecipientAction.bind(null, tenantId, campaignId),
          ...(hasModule(pack, "programmes") && !money(campaign.kind) ? { announce: announceAudienceAction.bind(null, tenantId, campaignId) } : {}),
        }}
      />
    ) : data.tab === "approve" ? (
      <ApprovalPanel preview={data.preview} role={tenant.role} status={campaign.status} words={words} approve={approveCampaignAction.bind(null, tenantId, campaignId)} />
    ) : (
      <ResultsView results={data.results} words={words} />
    );
  const notice = pick(raw.back) === "1" ? <p role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-base">{words["camp.backtodraft"]}</p> : pick(raw.saved) === "1" ? <p role="status" className="rounded-lg border border-green-text bg-green-bg p-3 text-base font-medium text-green-text">{words["camp.saved"]}</p> : null;
  return (
    <main className={pageMain} lang={lang}>
      <CampaignHub base={base} words={words} campaign={campaign} tab={tab} notice={notice}>
        {admin ? <CampaignControls status={campaign.status} words={words} act={campaignStateAction.bind(null, tenantId, campaignId)} /> : null}
        {body}
      </CampaignHub>
    </main>
  );
}

/** The call list: who a money reminder did not reach and who has not paid. */
export async function CallListPage({ accessToken, tenantId, tenant, raw }: CampaignContext & { raw: Raw }) {
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const words = campaignWords(lang);
  const tab = pick(raw.tab) === "done" ? "done" : "open";
  const rawAfter = pick(raw.after);
  const after = rawAfter && rawAfter.length <= MAX_CURSOR ? rawAfter : null;
  let page: Awaited<ReturnType<typeof getCallList>> | null = null;
  try {
    page = await getCallList(accessToken, tenantId, { status: tab, after });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
  }
  const admin = tenant.role === "owner" || tenant.role === "admin";
  return (
    <main className={pageMain} lang={lang}>
      <header className="mb-4 flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-semibold leading-[1.15] md:text-4xl md:leading-[1.1]">{words["nav.item.calllist"]}</h1>
        <p className="text-base text-muted">{words["camp.cl.sub"]}</p>
      </header>
      {page === null ? (
        <p role="alert" className="rounded-2xl border border-line p-4 text-base">{words["camp.loaderr"]}</p>
      ) : (
        <CallList
          items={page.items}
          words={words}
          canCall={admin}
          today={todayInIndia(clock())}
          tab={tab}
          base={base}
          more={page.next_cursor ? `${base}/call-list?${tab === "done" ? "tab=done&" : ""}after=${encodeURIComponent(page.next_cursor)}` : null}
          actions={{ connect: connectCallAction.bind(null, tenantId), outcome: callOutcomeAction.bind(null, tenantId) }}
        />
      )}
    </main>
  );
}
