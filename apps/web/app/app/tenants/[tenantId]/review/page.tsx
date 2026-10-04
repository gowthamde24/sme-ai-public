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
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}`} className="tap">
          ← Workspace
        </Link>
      </p>

      <div className="review-card-header">
        <div>
          <h1>Lead Review Queue</h1>
          <p className="hint">
            Qualify candidate leads against your Ideal Customer Profile (ICP). Unbiased blind review is{" "}
            {blind ? <strong>enabled</strong> : <span>disabled</span>}.
          </p>
        </div>
        <div>
          <span className="badge">Role: {tenant.role}</span>
        </div>
      </div>

      {/* ICP Profile Status Banner */}
      <div className="review-card" style={{ padding: "0.75rem 1rem", margin: "1rem 0" }}>
        <div className="row between">
          <div>
            <strong>Active ICP Profile:</strong>{" "}
            {activeIcp ? (
              <span>
                Version {activeIcp.version_no} (SHA-256: <code>{activeIcp.config_sha256.slice(0, 12)}...</code>)
              </span>
            ) : (
              <span className="hint">No profile published yet (leads remain unscored)</span>
            )}
          </div>
          {canExport && (
            <div>
              <div className="row">
                <a
                  href={`/app/tenants/${tenantId}/review/export?format=csv`}
                  className="badge badge-priority tap"
                  style={{ textDecoration: "none", cursor: "pointer" }}
                  download
                >
                  Export CSV
                </a>
                <a
                  href={`/app/tenants/${tenantId}/review/export?format=json`}
                  className="badge badge-worth-reviewing tap"
                  style={{ textDecoration: "none", cursor: "pointer" }}
                  download
                >
                  Export JSON
                </a>
              </div>
              <p className="hint">
                The file lists every label with its reason, score, and the company&apos;s name, city and lead source. Every export
                is logged (who, when, how many rows).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="tabs" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="hint" style={{ marginRight: "0.5rem" }}>
            Filter:
          </span>
          <Link href={here({ band: null, unreviewed: false })} className="tap" aria-current={!scoreBand && !unreviewed ? "page" : undefined}>
            All
          </Link>
          <Link href={here({ unreviewed: true })} className="tap" aria-current={unreviewed ? "page" : undefined}>
            Unreviewed only
          </Link>
          {blind ? (
            <span className="hint">Score filters are available only with Blind Scoring off.</span>
          ) : (
            SCORE_BANDS.map((band) => (
              <Link key={band} href={here({ band })} className="tap" aria-current={band === scoreBand ? "page" : undefined}>
                {SCORE_BAND_LABELS[band]}
              </Link>
            ))
          )}
        </div>

        <div className="row">
          <Link
            href={here({ blind: !blind })}
            className={`badge tap ${blind ? "badge-priority" : "badge-hidden"}`}
            style={{ textDecoration: "none" }}
          >
            {blind ? "Blind Scoring: ON" : "Blind Scoring: OFF"}
          </Link>
        </div>
      </div>

      {/* Import Section (for Owner/Admin/Sales) */}
      {canWrite && <ImportLeadsForm tenantId={tenantId} />}

      {/* Queue items */}
      <section aria-labelledby="queue-heading" style={{ marginTop: "1.5rem" }}>
        <h2 id="queue-heading">Candidate Leads ({queue.items.length})</h2>

        {canWrite && queue.items.length > 0 && (
          <div className="sticky-actions sticky">
            {firstUnreviewed ? (
              <a href={`#lead-${firstUnreviewed.lead_id}`} className="button tap">
                Next unreviewed ↓
              </a>
            ) : queue.next_cursor ? (
              <Link href={here({ cursor: queue.next_cursor })} className="button tap">
                All reviewed here · load more →
              </Link>
            ) : (
              <span className="hint">Everything in this view is reviewed.</span>
            )}
          </div>
        )}

        {queue.items.length === 0 ? (
          <p className="hint">
            {cursor ? "No more leads in this view." : "No leads in the review queue yet."}
          </p>
        ) : (
          <div>
            {queue.items.map((item) => {
              const comp = item.company || {};
              const cont = item.contact;
              const hasLabel = item.latest_label !== null;
              const label = item.latest_label?.label;
              const reason = item.latest_label?.reason_code;

              return (
                <article key={item.lead_id} id={`lead-${item.lead_id}`} className="review-card">
                  <div className="review-card-header">
                    <div>
                      <h3 style={{ margin: "0 0 0.25rem" }}>
                        {String(comp.name || "Unnamed Company")}
                      </h3>
                      <p className="hint">
                        {String(comp.city || "—")}, {String(comp.country || "—")} ·{" "}
                        {String(comp.industry || "General")} · Source: {item.source || "import"}
                      </p>
                    </div>

                    <div className="row">
                      {/* Status / Label Badge */}
                      {hasLabel ? (
                        <span className={`badge badge-${label}`}>
                          {label?.toUpperCase()}
                          {reason ? ` (${reason})` : ""}
                        </span>
                      ) : (
                        <span className="badge badge-hidden">Unreviewed</span>
                      )}

                      {/* Score Badge */}
                      {item.score !== null && item.score !== undefined ? (
                        <span className={`badge badge-${item.score_band || "low-priority"}`}>
                          Score: {item.score}/100
                        </span>
                      ) : (
                        <span className="badge badge-hidden" title="Hidden to avoid confirmation bias">
                          Score Hidden (Blind)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Summary Details */}
                  <dl className="summary" style={{ margin: "0.25rem 0" }}>
                    <dt>Contact</dt>
                    <dd>
                      {cont ? (
                        <details className="card-compact">
                          <summary className="tap">Contact details</summary>
                          <span>
                            {String(cont.full_name || "—")}{" "}
                            {cont.job_title ? `(${String(cont.job_title)})` : ""} ·{" "}
                            {String(cont.email || "—")} · {String(cont.phone || "—")}
                          </span>
                        </details>
                      ) : (
                        <span className="hint">No contact information attached</span>
                      )}
                    </dd>

                    <dt>Evidence</dt>
                    <dd>
                      <Link href={`/app/tenants/${tenantId}/leads/${item.lead_id}`} className="tap">
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
          <p>
            <Link href={here({ cursor: queue.next_cursor })} rel="next" className="tap">
              Load more leads
            </Link>
          </p>
        )}

        {cursor && (
          <p>
            <Link href={here()} className="tap">
              Back to first page
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}

function ApiDown() {
  return (
    <p role="alert" className="error">
      Could not load the review queue from the API. Try again shortly.
    </p>
  );
}

