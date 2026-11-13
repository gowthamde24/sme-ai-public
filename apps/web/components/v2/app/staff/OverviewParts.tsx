import Link from "next/link";
import type { ReactNode } from "react";

import { ago, count, orDash, percentText, shortDate, waiting } from "@/lib/staff/format";
import type { BusinessRow, HealthComponent, Overview, ProviderCost, Ticket } from "@/lib/staff/types";
import { CHANNEL, HEALTH_WORD, PRIORITY, PROVIDER, PROVIDER_ROLE, STATUS, TEXT } from "@/lib/staff/words";

import { StaffIcon } from "./StaffIcon";
import { ViewButton } from "./ViewButton";

/**
 * The cards of the Overview, one small server component each (approved mock approved-mocks/admin-overview.html). Honest drawing, from C1's contract: a block the role does not get is NOT drawn (never as zero); the MRR change is hidden until the API has one; the
 * margin says since when costs are counted (this month's margin is partial); a health state the API cannot measure is grey and says "Not measured", never green. Money is the API's own text; nothing is added up here.
 */

export function Kpis({ kpis }: { kpis: Overview["kpis"] }) {
  const { mrr, active, calls, margin } = kpis;
  const change = mrr?.changePercent ?? null;
  return (
    <div className="sc-kps" data-part="kpis">
      {mrr ? (
        <div className="sc-kp" data-kpi="mrr">
          <span className="sc-kl">MRR</span>
          <b>{mrr.text}</b>
          {change !== null ? <small className={change < 0 ? "sc-down" : undefined}>{change < 0 ? "▼" : "▲"} {percentText(Math.abs(change))}% this month</small> : null}
        </div>
      ) : null}
      <div className="sc-kp" data-kpi="active">
        <span className="sc-kl">Active businesses</span>
        <b>{count(active.count)}</b>
        <small>{active.addedThisWeek > 0 ? `▲ ${count(active.addedThisWeek)} this week` : "None added this week"} · {count(active.onFreeStart)} on free start</small>
      </div>
      <div className="sc-kp" data-kpi="calls">
        <span className="sc-kl">Calls today</span>
        <b>{count(calls.count)}</b>
        {calls.connectedPercent !== null ? <small>{percentText(calls.connectedPercent)}% connected</small> : <small className="sc-dim">No calls yet</small>}
      </div>
      {margin ? (
        <div className="sc-kp" data-kpi="margin">
          <span className="sc-kl">Gross margin</span>
          <b>{margin.percent !== null ? `${percentText(margin.percent)}%` : "—"}</b>
          <small>after provider costs</small>
          {margin.costsRecordedSince ? <small className="sc-dim">costs counted since {shortDate(margin.costsRecordedSince)}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

function TicketRow({ t }: { t: Ticket }) {
  return (
    <div className="sc-tk" data-part="ticket">
      <span className="sc-pr" data-p={t.priority}>{PRIORITY[t.priority]}</span>
      <div className="sc-tt">
        <b>{t.businessName}</b>
        <span>{t.subject}</span>
      </div>
      <span className="sc-chn">{CHANNEL[t.channel] ?? t.channel} · {waiting(t.waitingMinutes)}</span>
      <span className="sc-as">{t.assignee ?? "—"}</span>
    </div>
  );
}

export function SupportQueue({ queue }: { queue: NonNullable<Overview["supportQueue"]> }) {
  const rest = queue.totalOpen - queue.items.length;
  return (
    <section className="sc-card" data-part="queue" aria-labelledby="sc-queue-h">
      <div className="sc-ch">
        <h3 id="sc-queue-h">Support queue · {count(queue.totalOpen)} open</h3>
      </div>
      {queue.items.length === 0 ? <p className="sc-empty">Nothing is waiting.</p> : queue.items.map((t, i) => <TicketRow key={`${t.businessName}-${i}`} t={t} />)}
      {rest > 0 ? <div className="sc-more">{count(rest)} more open</div> : null}
    </section>
  );
}

function stateText(c: HealthComponent): string {
  if (c.state === "healthy") return HEALTH_WORD.healthy;
  if (c.state === "unknown") return HEALTH_WORD.unknown;
  return c.note || HEALTH_WORD[c.state];
}

export function SystemHealth({ components }: { components: HealthComponent[] }) {
  return (
    <section className="sc-card" data-part="health" aria-labelledby="sc-health-h">
      <div className="sc-ch">
        <h3 id="sc-health-h">System health</h3>
      </div>
      {components.map((c) => (
        <div className="sc-hr" key={c.key} data-state={c.state} title={c.state === "unknown" && c.note ? c.note : undefined}>
          <i data-s={c.state} aria-hidden="true" />
          <span>{c.label}</span>
          <em data-s={c.state}>{stateText(c)}</em>
        </div>
      ))}
    </section>
  );
}

export function BusinessesCard({ rows, total, nowIso }: { rows: BusinessRow[]; total: number; nowIso: string }) {
  return (
    <section className="sc-card" data-part="businesses" aria-labelledby="sc-biz-h">
      <div className="sc-ch">
        <h3 id="sc-biz-h">Businesses</h3>
        <span>{count(total)} in all</span>
      </div>
      <div className="sc-scroll">
      <table className="sc-table">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th scope="col">Plan</th>
            <th scope="col">Status</th>
            <th scope="col">Balance</th>
            <th scope="col">Last activity</th>
            <th scope="col"><span className="sc-sr">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.tenantId}>
              <td data-label="Business">
                <span>
                  <b>{b.name}</b>
                  <small>{orDash(b.town)}</small>
                </span>
              </td>
              <td data-label="Plan">{orDash(b.planName)}</td>
              <td data-label="Status"><span className="sc-st" data-st={b.status}>{STATUS[b.status]}</span></td>
              <td data-label="Balance" className="sc-num">{b.balanceText}</td>
              <td data-label="Last activity" className="sc-mut">{ago(b.lastActivityAt, nowIso)}</td>
              <td data-label="Action"><ViewButton tenantId={b.tenantId} name={b.name} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function ProviderRow({ p, max }: { p: ProviderCost; max: number }) {
  const width = max > 0 ? Math.round((p.costPaise / max) * 100) : 0;
  return (
    <div className="sc-pv" data-provider={p.provider}>
      <div>
        <b>{PROVIDER_ROLE[p.role] ?? p.role.replace(/_/g, " ")}</b>
        <span>{PROVIDER[p.provider] ?? p.provider}</span>
      </div>
      <div className="sc-pb" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
      <b className="sc-num">{p.costText}</b>
    </div>
  );
}

export function CostsCard({ costs, since }: { costs: NonNullable<Overview["costs"]>; since: string | null }) {
  const max = Math.max(0, ...costs.providers.map((p) => p.costPaise));
  return (
    <section className="sc-card" data-part="costs" aria-labelledby="sc-costs-h">
      <div className="sc-ch">
        <h3 id="sc-costs-h">Our costs this month</h3>
      </div>
      {costs.providers.map((p) => <ProviderRow key={p.provider} p={p} max={max} />)}
      <div className="sc-mg">
        <span>Revenue {costs.revenueText} · costs {costs.costText}</span>
        <span>Margin <b>{costs.marginText}</b></span>
      </div>
      {since ? <div className="sc-since">{TEXT.costsSince(shortDate(since))}</div> : null}
    </section>
  );
}

export function PrivacyNote(): ReactNode {
  return (
    <p className="sc-note" data-part="privacy">
      <StaffIcon name="compliance" size={15} />
      <span>{TEXT.privacy}</span>
    </p>
  );
}

export function BackLink({ keep }: { keep: string }) {
  return <Link className="sc-back" href={`/staff${keep}`}>← {TEXT.backToOverview}</Link>;
}
