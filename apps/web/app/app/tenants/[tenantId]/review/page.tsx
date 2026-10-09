import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import {
  fetchActiveIcpConfig,
  fetchReviewQueue,
  SCORE_BAND_LABELS,
  SCORE_BANDS,
  type PageReviewQueueLeadOut,
  type ScoreBand,
} from "@/lib/api/leads";
import { Pill } from "@/components/v2/app/parts";
import { alertBox, btnMainLink, cardBoxFull, codeInline, detailsBox, hintInline, kvList, link, listPlain, mutedText, pageH1, pageH2, pageH3, pageMain, pillLinkBase, pillLinkGreen, pillLinkGreenOn, pillLinkInfo, pillLinkQuiet, rowBetween, rowWrap, sectionBlock, spaceTop, stickyActions, summaryLine, surfaceFlat, tabLink, tabLinkOn, tabRow } from "@/components/v2/app/ui";
import { requireUser } from "@/lib/auth/session";

import { FactorBreakdown } from "./factor-breakdown";
import { ImportLeadsForm } from "./import-leads-form";
import { LeadLabelForm } from "./lead-label-form";

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
    return <ApiDown />;
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
    return <ApiDown />;
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
    <main className={pageMain}>

      <div className={rowBetween}>
        <div>
          <h1 className={pageH1}>Lead Review Queue</h1>
          <p className={mutedText}>
            Qualify candidate leads against your Ideal Customer Profile (ICP). Unbiased blind review is{" "}
            {blind ? <strong>enabled</strong> : <span>disabled</span>}.
          </p>
        </div>
        <div>
          <Pill tone="neutral">Role: {tenant.role}</Pill>
        </div>
      </div>

      {/* ICP Profile Status Banner */}
      <div className={`mt-4 ${surfaceFlat}`}>
        <div className={rowBetween}>
          <div>
            <strong>Active ICP Profile:</strong>{" "}
            {activeIcp ? (
              <span>
                Version {activeIcp.version_no} (SHA-256: <code className={codeInline}>{activeIcp.config_sha256.slice(0, 12)}...</code>)
              </span>
            ) : (
              <span className={hintInline}>No profile published yet (leads remain unscored)</span>
            )}
          </div>
          {canExport && (
            <div>
              <div className={rowWrap}>
                <a href={`/app/tenants/${tenantId}/review/export?format=csv`} className={pillLinkGreen} download>
                  Export CSV
                </a>
                <a href={`/app/tenants/${tenantId}/review/export?format=json`} className={pillLinkInfo} download>
                  Export JSON
                </a>
              </div>
              <p className={mutedText}>
                The file lists every label with its reason, score, and the company&apos;s name, city and lead source. Every export
                is logged (who, when, how many rows).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filters and Controls */}
      <div className={`${tabRow} items-center justify-between`}>
        <div className={rowWrap}>
          <span className={hintInline}>Filter:</span>
          <Link href={here({ band: null, unreviewed: false })} className={`${tabLink} ${!scoreBand && !unreviewed ? tabLinkOn : ""}`} aria-current={!scoreBand && !unreviewed ? "page" : undefined}>
            All
          </Link>
          <Link href={here({ unreviewed: true })} className={`${tabLink} ${unreviewed ? tabLinkOn : ""}`} aria-current={unreviewed ? "page" : undefined}>
            Unreviewed only
          </Link>
          {blind ? (
            <span className={hintInline}>Score filters are available only with Blind Scoring off.</span>
          ) : (
            SCORE_BANDS.map((band) => (
              <Link key={band} href={here({ band })} className={`${tabLink} ${band === scoreBand ? tabLinkOn : ""}`} aria-current={band === scoreBand ? "page" : undefined}>
                {SCORE_BAND_LABELS[band]}
              </Link>
            ))
          )}
        </div>

        <div className={rowWrap}>
          <Link href={here({ blind: !blind })} className={`${pillLinkBase} ${blind ? pillLinkGreenOn : pillLinkQuiet}`}>
            {blind ? "Blind Scoring: ON" : "Blind Scoring: OFF"}
          </Link>
        </div>
      </div>

      {/* Import Section (for Owner/Admin/Sales) */}
      {canWrite && <ImportLeadsForm tenantId={tenantId} />}

      {/* Queue items */}
      <section aria-labelledby="queue-heading" className={sectionBlock}>
        <h2 id="queue-heading" className={pageH2}>Candidate Leads ({queue.items.length})</h2>

        {canWrite && queue.items.length > 0 && (
          <div className={stickyActions}>
            {firstUnreviewed ? (
              <a href={`#lead-${firstUnreviewed.lead_id}`} className={btnMainLink}>
                Next unreviewed ↓
              </a>
            ) : queue.next_cursor ? (
              <Link href={here({ cursor: queue.next_cursor })} className={btnMainLink}>
                All reviewed here · load more →
              </Link>
            ) : (
              <span className={hintInline}>Everything in this view is reviewed.</span>
            )}
          </div>
        )}

        {queue.items.length === 0 ? (
          <p className={mutedText}>
            {cursor ? "No more leads in this view." : "No leads in the review queue yet."}
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
                      <h3 className={pageH3}>{String(comp.name || "Unnamed Company")}</h3>
                      <p className={mutedText}>
                        {String(comp.city || "—")}, {String(comp.country || "—")} ·{" "}
                        {String(comp.industry || "General")} · Source: {item.source || "import"}
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
                        <Pill tone="neutral">Unreviewed</Pill>
                      )}

                      {/* Score Badge */}
                      {item.score !== null && item.score !== undefined ? (
                        <Pill tone={BAND_TONE[item.score_band ?? "low_priority"] ?? "neutral"}>
                          Score: {item.score}/100
                        </Pill>
                      ) : (
                        <span title="Hidden to avoid confirmation bias">
                          <Pill tone="neutral">Score Hidden (Blind)</Pill>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Summary Details */}
                  <dl className={kvList}>
                    <dt>Contact</dt>
                    <dd>
                      {cont ? (
                        <details className={detailsBox}>
                          <summary className={summaryLine}>Contact details</summary>
                          <span>
                            {String(cont.full_name || "—")}{" "}
                            {cont.job_title ? `(${String(cont.job_title)})` : ""} ·{" "}
                            {String(cont.email || "—")} · {String(cont.phone || "—")}
                          </span>
                        </details>
                      ) : (
                        <span className={hintInline}>No contact information attached</span>
                      )}
                    </dd>

                    <dt>Evidence</dt>
                    <dd>
                      <Link href={`/app/tenants/${tenantId}/leads/${item.lead_id}`} className={link}>
                        View evidence &amp; details →
                      </Link>
                    </dd>
                  </dl>

                  {/* Factor breakdown if score is unblinded */}
                  {item.snapshot && (
                    <FactorBreakdown
                      factors={item.snapshot.factors}
                      flags={item.snapshot.flags}
                      maxReachable={item.score_max_reachable ?? null}
                    />
                  )}

                  {/* Review Labeling Actions */}
                  {canWrite && (
                    <LeadLabelForm
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
              Load more leads
            </Link>
          </p>
        )}

        {cursor && (
          <p className={spaceTop}>
            <Link href={here()} className={link}>
              Back to first page
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

function ApiDown() {
  return (
    <p role="alert" className={alertBox}>
      Could not load the review queue from the API. Try again shortly.
    </p>
  );
}
