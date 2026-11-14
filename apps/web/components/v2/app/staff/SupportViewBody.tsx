import { BackLink } from "./OverviewParts";
import { GoodwillCredit } from "./GoodwillCredit";
import { PauseResume } from "./PauseResume";
import { PeopleLists } from "./PeopleLists";
import { StaffIcon } from "./StaffIcon";
import { count, orDash } from "@/lib/staff/format";
import type { StaffRole, SupportView } from "@/lib/staff/types";
import { STATUS, SUP, TEXT } from "@/lib/staff/words";

/**
 * The read-only support view of ONE business (`GET /v1/admin/businesses/{id}?access_id=`): a "Support view" banner, the figures of the last 30 days, how far setup is, the phone numbers and WhatsApp, the latest calls and chats. Customer names and numbers arrive
 * masked from the API and are drawn as they come (owner and support can unmask them for one look, with a second reason); there is no message text and no transcript. What the view can change is only the assistant's pause and (owner) a goodwill credit.
 */
export function SupportViewBody({ view, keep, tenantId, accessId, role }: { view: SupportView; keep: string; tenantId: string; accessId: string; role: StaffRole }) {
  const n = view.numbers30d;
  const tiles: [string, string][] = [
    ["Calls", count(n.calls)],
    ["Call minutes", count(n.callMinutes)],
    ["Messages sent", count(n.messagesSent)],
    ["Leads", count(n.leads)],
    ["Quotes", count(n.quotes)],
    ["Visits", count(n.visits)],
  ];
  const yes = (v: boolean) => (v ? "Done" : "Not yet");
  return (
    <>
      <div className="sc-banner" role="status" data-part="support-banner">
        <StaffIcon name="eye" size={18} />
        <div>
          <b>{TEXT.banner}</b>
          <span>{TEXT.bannerBody}</span>
        </div>
      </div>
      <div><BackLink keep={keep} /></div>
      {view.business ? (
        <p className="sc-asof">
          {orDash(view.business.town)} · {orDash(view.business.planName)} · <span className="sc-st" data-st={view.business.status}>{STATUS[view.business.status]}</span> · Balance {view.business.balanceText}
        </p>
      ) : null}
      {view.business && role !== "finance" ? (
        <div className="sc-toolrow" data-part="business-actions">
          {view.business.status === "paused" ? <span className="sc-note-inline">{SUP.supportViewPaused}</span> : null}
          <PauseResume tenantId={tenantId} name={view.business.name} paused={view.business.status === "paused"} />
          {role === "owner" ? <GoodwillCredit tenantId={tenantId} name={view.business.name} /> : null}
        </div>
      ) : null}
      <div className="sc-kps sc-tiles" data-part="numbers">
        {tiles.map(([label, value]) => (
          <div className="sc-kp" key={label}>
            <span className="sc-kl">{label} · last 30 days</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <div className="sc-g2">
        <section className="sc-card" aria-labelledby="sc-setup-h">
          <div className="sc-ch"><h3 id="sc-setup-h">Setup</h3></div>
          <ul className="sc-list">
            <li className="sc-li"><span>Business name</span><b>{view.setup.businessName}</b></li>
            <li className="sc-li"><span>Phone number</span><b>{orDash(view.setup.phoneNumber)}</b></li>
            <li className="sc-li"><span>Voice saved</span><b>{yes(view.setup.voiceSaved)}</b></li>
            <li className="sc-li"><span>Rules saved</span><b>{yes(view.setup.rulesSaved)}</b></li>
            <li className="sc-li"><span>WhatsApp</span><b>{view.whatsapp.connected ? `Connected${view.whatsapp.displayPhone ? ` · ${view.whatsapp.displayPhone}` : ""}` : "Not connected"}</b></li>
          </ul>
        </section>
        <section className="sc-card" aria-labelledby="sc-phones-h">
          <div className="sc-ch"><h3 id="sc-phones-h">Phone numbers</h3></div>
          {view.phoneNumbers.length === 0 ? <p className="sc-empty">No phone number yet.</p> : (
            <ul className="sc-list">
              {view.phoneNumbers.map((p) => (
                <li className="sc-li" key={p.number}><span>{p.number}{p.label ? <small>{p.label}</small> : null}</span><b>{p.inboundOn ? "Answering calls" : "Not answering"}</b></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <PeopleLists calls={view.recentCalls} chats={view.recentChats} tenantId={tenantId} accessId={accessId} canUnmask={role !== "finance"} />
    </>
  );
}
