import { ago, orDash } from "@/lib/staff/format";
import type { BusinessList, StaffRole } from "@/lib/staff/types";
import { STATUS, SUP } from "@/lib/staff/words";

import { GoodwillCredit } from "./GoodwillCredit";
import { ViewButton } from "./ViewButton";

/**
 * The businesses of Stack19 (every staff role): name, town, plan, balance, status and last activity, with a search box (a plain GET form: `?q=`). "View" (owner and support) asks for a reason first; "Goodwill credit" (owner and finance)
 * asks its own. No customer data here: that is behind the reason box.
 */
export function BusinessesTable({ list, q, role, nowIso, keepRole }: { list: BusinessList; q: string; role: StaffRole; nowIso: string; keepRole: string }) {
  const canView = role !== "finance";
  const canCredit = role !== "support";
  return (
    <section className="sc-card" data-part="businesses" aria-labelledby="sc-biz-h">
      <div className="sc-ch">
        <h3 id="sc-biz-h">{SUP.businessesTitle}</h3>
        <form method="get" action="/staff/businesses" className="sc-find" role="search">
          {keepRole ? <input type="hidden" name="role" value={keepRole} /> : null}
          <label className="sc-sr" htmlFor="sc-biz-q">{SUP.businessesSearch}</label>
          <input id="sc-biz-q" name="q" className="sc-input" type="search" defaultValue={q} placeholder={SUP.businessesSearch} maxLength={80} />
          <button type="submit" className="sc-btn">{SUP.businessesSearchGo}</button>
        </form>
      </div>
      {list.items.length === 0 ? (
        <p className="sc-empty">{SUP.businessesNone}</p>
      ) : (
        <div className="sc-scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th>{SUP.colBusiness}</th>
                <th>{SUP.colPlan}</th>
                <th>{SUP.colBalance}</th>
                <th>{SUP.colStatus}</th>
                <th>{SUP.colActivity}</th>
                <th>{SUP.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((b) => (
                <tr key={b.tenantId}>
                  <td data-label="Business"><b>{b.name}</b><small>{orDash(b.town)}</small></td>
                  <td data-label={SUP.colPlan}>{orDash(b.planName)}</td>
                  <td data-label={SUP.colBalance} className="sc-num">{b.balanceText}</td>
                  <td data-label={SUP.colStatus}><span className="sc-st" data-st={b.status}>{STATUS[b.status]}</span></td>
                  <td data-label={SUP.colActivity} className="sc-mut">{ago(b.lastActivityAt, nowIso)}</td>
                  <td data-label="Action">
                    <span className="sc-chips">
                      {canView ? <ViewButton tenantId={b.tenantId} name={b.name} /> : null}
                      {canCredit ? <GoodwillCredit tenantId={b.tenantId} name={b.name} /> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.nextCursor ? <div className="sc-more">{SUP.businessesMore}</div> : null}
    </section>
  );
}
