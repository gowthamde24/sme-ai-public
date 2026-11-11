import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageTop, NotShownV2, ApiDownV2 } from "@/components/v2/app/parts";
import { FinderBox } from "@/components/v2/app/prospects/FinderBox";
import { FinderV4 } from "@/components/v2/app/prospects/FinderV4";
import { ProspectList } from "@/components/v2/app/prospects/ProspectList";
import { WRITERS } from "@/components/v2/app/nav";
import { alertBox, btnQuiet, mutedText, pageMain, pillLinkBase, pillLinkInfo, pillLinkQuiet } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getProspect, getProspectStats, listProspects, listSearches, redecideProspects } from "@/lib/api/lead-finder";
import { appV4 } from "@/lib/screens/flag";
import { buildRadar, checkedOf } from "@/lib/lead-finder/radar";
import { PlanUpsell } from "@/components/v2/app/plan/PlanUpsell";
import { upgradeHref } from "@/lib/plan/tier-source";

import { readFinderAccessCached } from "../../../frame-data";
import { STATUS_FILTER, type ProspectPage, type ProspectStats, type ProspectStatus } from "@/lib/lead-finder/types";
import { requireUser } from "@/lib/auth/session";

import { approveSearchAction, cancelSearchAction, makeQuoteDraftAction, planLikeThisAction, planSearchAction, practiceCallAction, prospectActionsAction, quoteDraftAction } from "./actions";
import { menuTitle } from "../menu-title";

export const metadata = { title: `Prospects · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
/** A read that fails is null (the page says it could not load); a rejected session still goes to sign in. */
const orNull = (error: unknown): null => {
  if (error instanceof ApiAuthError) throw error;
  return null;
};

/**
 * /app/tenants/[tenantId]/retailers: the PROSPECTS tab of Customers (job lead-finder part D; docs/contracts/lead-finder.md; it replaced job CC's map search, so there is one place to find new customers). New businesses that may buy,
 * best fit first, with the Researcher's decision (Ready to call / Needs you / Skipped / Waiting / Contacted / Qualified / Not interested), why, and where each came from: made-up businesses in a demo workspace, Google Maps in the
 * Owner Test workspace only ("Google Maps" is shown next to its data). The box on top plans a search (the Owner or an Admin OKs it). For the Owner, Admin and Sales; a Viewer is told it is not theirs. Where the API says the
 * Lead Finder is not available (a school, or switched off) the page is not there (404), like the menu, which does not offer it. Opening the page asks the API to decide again the businesses that waited for the calling hours or the
 * day's cap. Nothing here dials a number: the only call is the practice call in the simulator.
 */
export default async function ProspectsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/retailers">) {
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
  if (!(WRITERS as readonly string[]).includes(tenant.role)) return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("lf.title")} message={t("lf.viewer")} />;
  const token = user.accessToken;
  const base = `/app/tenants/${tenantId}`;
  let access;
  try {
    access = await readFinderAccessCached(token, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    access = null;
  }
  // a Lead Desk plan (owner decision 4 Nov): the friendly "part of AI Workforce" card where the Lead Finder would be; nothing is read or decided for it
  if (access?.access === "upsell")
    return (
      <main className={pageMain} lang={lang}>
        <PageTop title={t("lf.title")} sub={t("lf.sub")} />
        <div className="mt-4">
          <PlanUpsell words={wordsFor(lang, ["tier.upsell."])} planHref={upgradeHref(base, tenant.role)} />
        </div>
      </main>
    );
  const finder = access?.availability ?? null;
  if (access?.access === "hidden" && finder) notFound();

  const statusRaw = one(query.status);
  const status = (STATUS_FILTER as readonly string[]).includes(statusRaw ?? "") ? (statusRaw as ProspectStatus) : null;
  const idRaw = one(query.id);
  const onlyId = idRaw && isCanonicalUuid(idRaw) ? idRaw : null;
  // Today's "Call" on one business (owner, 5 Nov): its practice call opens at once
  const practiceOpen = onlyId && one(query.practice) === "1" ? onlyId : null;
  const cursorRaw = one(query.cursor);
  const cursor = cursorRaw && cursorRaw.length <= 80 ? cursorRaw : null;

  let page: ProspectPage | null = null;
  let stats: ProspectStats | null = null;
  let gone = false;
  try {
    if (finder) {
      // the ones that waited for the calling hours or the day's cap are decided again when the screen opens (the worker does it too); a failure here never keeps the list from showing
      await redecideProspects(token, tenantId).catch(orNull);
      if (onlyId) {
        page = await getProspect(token, tenantId, onlyId).then(
          (p) => ({ items: [p], nextCursor: null }),
          (e) => {
            if (e instanceof ApiRequestError && e.status === 404) {
              gone = true;
              return { items: [], nextCursor: null };
            }
            return orNull(e);
          },
        );
      } else {
        [page, stats] = await Promise.all([listProspects(token, tenantId, { status, cursor, limit: 50 }).catch(orNull), getProspectStats(token, tenantId).catch(orNull)]);
      }
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }

  const words = wordsFor(lang, ["lf.", "apierr."], ["today.state.draft"]);
  const admin = tenant.role === "owner" || tenant.role === "admin";
  const href = (s: ProspectStatus | null) => (s ? `${base}/retailers?${new URLSearchParams({ status: s })}` : `${base}/retailers`);
  const count = (s: ProspectStatus) => stats?.byStatus[s];
  if (appV4()) {
    // app v4 part 5 (from app-Finder.png): the search box, the radar, the shops with their decision, the three kinds of decision explained
    const latest = finder ? await listSearches(token, tenantId, 1).then((x) => x[0] ?? null, orNull) : null;
    return (
      <FinderV4
        lang={lang}
        t={t}
        w={wordsFor(lang, ["lf.", "apierr.", "nav.item.v4d-finder"], ["today.state.draft"])}
        words={words}
        base={base}
        finder={finder}
        around={latest?.area ?? null}
        radar={buildRadar(page?.items ?? [])}
        checked={checkedOf(stats)}
        total={stats?.total ?? page?.items.length ?? 0}
        stats={stats}
        page={page}
        status={status}
        onlyId={onlyId}
        gone={gone}
        practiceOpen={practiceOpen}
        admin={admin}
        langNames={{ en: CALL_LANG_NAMES.en, te: CALL_LANG_NAMES.te }}
        finderActions={{ plan: planSearchAction.bind(null, tenantId), approve: approveSearchAction.bind(null, tenantId), cancel: cancelSearchAction.bind(null, tenantId) }}
        cardActions={{
          act: prospectActionsAction.bind(null, tenantId),
          practice: practiceCallAction.bind(null, tenantId),
          quoteDraft: quoteDraftAction.bind(null, tenantId),
          makeQuoteDraft: makeQuoteDraftAction.bind(null, tenantId),
          planLikeThis: planLikeThisAction.bind(null, tenantId),
          approve: approveSearchAction.bind(null, tenantId),
          cancel: cancelSearchAction.bind(null, tenantId),
        }}
      />
    );
  }
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={await menuTitle("find", lang, token, tenantId)} sub={t("lf.sub")} />
      {finder?.source === "fixture" ? (
        <p role="note" className="mt-3 text-sm font-semibold text-info-text" data-demo="">
          {t("lf.demo")}
        </p>
      ) : null}
      {finder === null ? (
        <p role="alert" className={alertBox}>
          {t("lf.na")}
        </p>
      ) : (
        <div className="mt-4 flex max-w-3xl flex-col gap-4">
          <FinderBox words={words} canApprove={admin} base={base} actions={{ plan: planSearchAction.bind(null, tenantId), approve: approveSearchAction.bind(null, tenantId), cancel: cancelSearchAction.bind(null, tenantId) }} />
          {onlyId ? (
            <p className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted">{t(gone ? "lf.one.gone" : "lf.one")}</span>
              <Link href={href(null)} className={btnQuiet}>
                {t("lf.all")}
              </Link>
            </p>
          ) : (
            <nav aria-label={t("lf.f.label")} className="flex flex-wrap gap-2" data-filter="">
              {[null, ...STATUS_FILTER].map((s) => {
                const n = s ? count(s) : stats?.total;
                const word = s ? t(`lf.status.${s}`) : t("lf.f.all");
                return (
                  <Link key={s ?? "all"} href={href(s)} aria-current={s === status ? "page" : undefined} className={`${pillLinkBase} ${s === status ? pillLinkInfo : pillLinkQuiet}`}>
                    {n !== undefined ? `${word} (${n})` : word}
                  </Link>
                );
              })}
            </nav>
          )}
          {page === null ? (
            <p role="alert" className={alertBox}>
              {t("lf.na")}
            </p>
          ) : page.items.length === 0 ? (
            gone ? null : <p className={mutedText}>{t(status ? "lf.none.filter" : "lf.none")}</p>
          ) : (
            <ProspectList practiceOpen={practiceOpen} items={page.items} words={words} base={base} canPractice={admin} labelFixture={finder.source !== "fixture"} langNames={{ en: CALL_LANG_NAMES.en, te: CALL_LANG_NAMES.te }} actions={{ act: prospectActionsAction.bind(null, tenantId), practice: practiceCallAction.bind(null, tenantId), quoteDraft: quoteDraftAction.bind(null, tenantId), makeQuoteDraft: makeQuoteDraftAction.bind(null, tenantId) }} />
          )}
          {page?.nextCursor ? (
            <p>
              <Link href={`${base}/retailers?${new URLSearchParams({ ...(status ? { status } : {}), cursor: page.nextCursor })}`} className={btnQuiet}>
                {t("lf.more")}
              </Link>
            </p>
          ) : null}
          <p className={mutedText}>{t("lf.nocall")}</p>
        </div>
      )}
    </main>
  );
}
