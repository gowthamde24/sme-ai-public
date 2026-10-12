import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchActiveIcpConfig, fetchReviewQueue, SCORE_BANDS, type PageReviewQueueLeadOut, type ScoreBand } from "@/lib/api/leads";
import { LeadsTabs, PageTop, Pill } from "@/components/v2/app/parts";
import { alertBox, btnMainLink, cardBoxFull, codeInline, detailsBox, hintInline, kvList, link, listPlain, mutedText, pageH2, pageH3, pageMain, pillLinkBase, pillLinkGreen, pillLinkGreenOn, pillLinkInfo, pillLinkQuiet, rowBetween, rowWrap, sectionBlock, spaceTop, stickyActions, summaryLine, surfaceFlat, tabLink, tabLinkOn, tabRow } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { FactorBreakdown } from "./factor-breakdown";
import { ImportLeadsForm } from "./import-leads-form";
import { LeadLabelForm } from "./lead-label-form";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Lead Review Queue · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

const WRITE_ROLES = ["owner", "admin", "sales"];
const ADMIN_ROLES = ["owner", "admin"];
const MAX_CURSOR = 300;

function pick(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const lang = await getLang();
  const words = wordsFor(lang, ["rev.", "lead."]);
  const t = makeT(words);
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
    return <ApiDown words={words} />;
  }

  const rawBlind = pick(query.blind);
  const blind = rawBlind !== "false"; // default is true for blind review

  // A score band is a filter on a hidden value, so it exists only in the deliberate non-blind view
  // (the API refuses it otherwise).
  const rawBand = pick(query.score_band);
  const scoreBand: ScoreBand | undefined =
    !blind && (SCORE_BANDS as readonly string[]).includes(rawBand ?? "")
      ? (rawBand as ScoreBand)
      : undefined;

  const unreviewed = pick(query.unreviewed) === "true";

  const rawCursor = pick(query.cursor);
  const cursor = rawCursor && rawCursor.length <= MAX_CURSOR ? rawCursor : null;

  let activeIcp = null;
  try {
    activeIcp = await fetchActiveIcpConfig(user.accessToken, tenantId);
  } catch {
    // If ICP fetch fails, continue without active profile banner
  }

  let queue: PageReviewQueueLeadOut | null = null;
  try {
    queue = await fetchReviewQueue(user.accessToken, tenantId, {
      limit: 20,
      cursor,
      score_band: scoreBand,
      blind,
      unreviewed,
    });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDown words={words} />;
  }

  // One place builds every link of this page, so a filter (blind, band, unreviewed) is never silently dropped.
  const here = (over: { blind?: boolean; band?: ScoreBand | null; unreviewed?: boolean; cursor?: string | null } = {}) => {
    const b = over.blind ?? blind;
    const band = over.band === undefined ? scoreBand : over.band;
    const u = over.unreviewed ?? unreviewed;
    const params = new URLSearchParams();
    if (band && !b) params.set("score_band", band);
    params.set("blind", b ? "true" : "false");
    if (u) params.set("unreviewed", "true");
    if (over.cursor) params.set("cursor", over.cursor);
    return `/app/tenants/${tenantId}/review?${params.toString()}`;
  };
  const firstUnreviewed = queue.items.find((item) => item.latest_label === null);

  const canWrite = WRITE_ROLES.includes(tenant.role);
  const canExport = ADMIN_ROLES.includes(tenant.role);

  return (
    <main className={pageMain} lang={lang}>

      <PageTop
        title={t("rev.leads")}
        sub={
          <>
            <Rich t={t} k="rev.intro_blind" with={{ state: blind ? <strong>{t("rev.enabled")}</strong> : <span>{t("rev.disabled")}</span> }} />
          </>
        }
      />
      <LeadsTabs tenantId={tenantId} role={tenant.role} current="review" />

      {/* ICP Profile Status Banner */}
      <div className={`mt-4 ${surfaceFlat}`}>
        <div className={rowBetween}>
          <div>
            <strong>{t("rev.active_icp_profile")}</strong>{" "}
            {activeIcp ? (
              <span>
                <Rich t={t} k="rev.icp_version" vars={{ n: activeIcp.version_no }} with={{ hash: <code className={codeInline}>{activeIcp.config_sha256.slice(0, 12)}...</code> }} />
              </span>
            ) : (
              <span className={hintInline}>{t("rev.no_profile_published_yet_leads_remain")}</span>
            )}
          </div>
          {canExport && (
            <div>
              <div className={rowWrap}>
                <a href={`/app/tenants/${tenantId}/review/export?format=csv`} className={pillLinkGreen} download>
                  {t("rev.export_csv")}
                </a>
                <a href={`/app/tenants/${tenantId}/review/export?format=json`} className={pillLinkInfo} download>
                  {t("rev.export_json")}
                </a>
              </div>
              <p className={mutedText}>
                {t("rev.the_file_lists_every_label_with")}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filters and Controls */}
      <div className={`${tabRow} items-center justify-between`}>
        <div className={rowWrap}>
          <span className={hintInline}>{t("rev.filter")}</span>
          <Link href={here({ band: null, unreviewed: false })} className={`${tabLink} ${!scoreBand && !unreviewed ? tabLinkOn : ""}`} aria-current={!scoreBand && !unreviewed ? "page" : undefined}>
            {t("rev.all")}
          </Link>
          <Link href={here({ unreviewed: true })} className={`${tabLink} ${unreviewed ? tabLinkOn : ""}`} aria-current={unreviewed ? "page" : undefined}>
            {t("rev.unreviewed_only")}
          </Link>
          {blind ? (
            <span className={hintInline}>{t("rev.score_filters_are_available_only_with")}</span>
          ) : (
            SCORE_BANDS.map((band) => (
              <Link key={band} href={here({ band })} className={`${tabLink} ${band === scoreBand ? tabLinkOn : ""}`} aria-current={band === scoreBand ? "page" : undefined}>
                {t(`lead.band.${band}`)}
              </Link>
            ))
          )}
        </div>

        <div className={rowWrap}>
          <Link href={here({ blind: !blind })} className={`${pillLinkBase} ${blind ? pillLinkGreenOn : pillLinkQuiet}`}>
            {blind ? t("rev.blind_scoring_on") : t("rev.blind_scoring_off")}
          </Link>
        </div>
      </div>

      {/* Import Section (for Owner/Admin/Sales) */}
      {canWrite && <ImportLeadsForm words={words} tenantId={tenantId} />}

      {/* Queue items */}
      <section aria-labelledby="queue-heading" className={sectionBlock}>
        <h2 id="queue-heading" className={pageH2}>{t("rev.candidates_n", { n: queue.items.length })}</h2>

        {canWrite && queue.items.length > 0 && (
          <div className={stickyActions}>
            {firstUnreviewed ? (
              <a href={`#lead-${firstUnreviewed.lead_id}`} className={btnMainLink}>
                {t("rev.next_unreviewed")}
              </a>
            ) : queue.next_cursor ? (
              <Link href={here({ cursor: queue.next_cursor })} className={btnMainLink}>
                {t("rev.all_reviewed_here_load_more")}
              </Link>
            ) : (
              <span className={hintInline}>{t("rev.everything_in_this_view_is_reviewed")}</span>
            )}
          </div>
        )}

        {queue.items.length === 0 ? (
          <p className={mutedText}>
            {cursor ? t("rev.no_more_leads_in_this_view") : t("rev.no_leads_in_the_review_queue")}
          </p>
        ) : (
          <div className={listPlain}>
            {queue.items.map((item) => {
              const comp = item.company || {};
              const cont = item.contact;
              const hasLabel = item.latest_label !== null;
              const label = item.latest_label?.label;
              const reason = item.latest_label?.reason_code;

              return (
                <article key={item.lead_id} id={`lead-${item.lead_id}`} className={cardBoxFull}>
                  <div className={rowBetween}>
                    <div>
                      <h3 className={pageH3}>{String(comp.name || t("rev.unnamed"))}</h3>
                      <p className={mutedText}>
                        {String(comp.city || "—")}, {String(comp.country || "—")} ·{" "}
                        {t("rev.industry_source", { industry: String(comp.industry || t("rev.industry_general")), source: String(item.source || t("rev.source_import")) })}
                      </p>
                    </div>

                    <div className={rowWrap}>
                      {/* Status / Label Badge */}
                      {hasLabel ? (
                        <Pill tone={label === "good" ? "green" : label === "bad" ? "red" : "amber"}>
                          {label?.toUpperCase()}
                          {reason ? ` (${reason})` : ""}
                        </Pill>
                      ) : (
                        <Pill tone="neutral">{t("rev.unreviewed")}</Pill>
                      )}

                      {/* Score Badge */}
                      {item.score !== null && item.score !== undefined ? (
                        <Pill tone={BAND_TONE[item.score_band ?? "low_priority"] ?? "neutral"}>
                          {t("rev.score_n", { n: item.score })}
                        </Pill>
                      ) : (
                        <span title={t("rev.hidden_to_avoid_confirmation_bias")}>
                          <Pill tone="neutral">{t("rev.score_hidden_blind")}</Pill>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Summary Details */}
                  <dl className={kvList}>
                    <dt>{t("rev.contact")}</dt>
                    <dd>
                      {cont ? (
                        <details className={detailsBox}>
                          <summary className={summaryLine}>{t("rev.contact_details")}</summary>
                          <span>
                            {String(cont.full_name || "—")}{" "}
                            {cont.job_title ? `(${String(cont.job_title)})` : ""} ·{" "}
                            {String(cont.email || "—")} · {String(cont.phone || "—")}
                          </span>
                        </details>
                      ) : (
                        <span className={hintInline}>{t("rev.no_contact_information_attached")}</span>
                      )}
                    </dd>

                    <dt>{t("rev.evidence")}</dt>
                    <dd>
                      <Link href={`/app/tenants/${tenantId}/leads/${item.lead_id}`} className={link}>
                        {t("rev.view_evidence_details")}
                      </Link>
                    </dd>
                  </dl>

                  {/* Factor breakdown if score is unblinded */}
                  {item.snapshot && (
                    <FactorBreakdown words={words}
                      factors={item.snapshot.factors}
                      flags={item.snapshot.flags}
                      maxReachable={item.score_max_reachable ?? null}
                    />
                  )}

                  {/* Review Labeling Actions */}
                  {canWrite && (
                    <LeadLabelForm words={words}
                      tenantId={tenantId}
                      leadId={item.lead_id}
                      labelId={crypto.randomUUID()}
                      currentLabel={label}
                      currentReason={reason}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}

        {queue.next_cursor && (
          <p className={spaceTop}>
            <Link href={here({ cursor: queue.next_cursor })} rel="next" className={link}>
              {t("rev.load_more_leads")}
            </Link>
          </p>
        )}

        {cursor && (
          <p className={spaceTop}>
            <Link href={here()} className={link}>
              {t("rev.back_to_first_page")}
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}

const BAND_TONE: Record<string, "green" | "info" | "amber" | "neutral"> = {
  priority: "green",
  worth_reviewing: "info",
  "worth-reviewing": "info",
  maybe: "amber",
  low_priority: "neutral",
  "low-priority": "neutral",
};

function ApiDown({ words }: { words?: Words }) {
  const t = makeT(words);
  return (
    <p role="alert" className={alertBox}>
      {t("rev.could_not_load_the_review_queue")}
    </p>
  );
}
