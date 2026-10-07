import Link from "next/link";

import type { ChannelTab } from "./followup-logic";

/**
 * The channels of one lead as links (E-mail, then WhatsApp): the address names the channel, so the page stays a server page, works without scripts and can be bookmarked. The current tab is marked;
 * each tab says whether its channel is open or why not, in closed words (no state at all when the API did not report one). Nothing here sends anything.
 */
export function ChannelTabs({ tenantId, leadId, tabs }: { tenantId: string; leadId: string; tabs: ChannelTab[] }) {
  return (
    <nav aria-label="Channel">
      <ul style={{ display: "flex", gap: "1rem", listStyle: "none", padding: 0, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <li key={t.channel}>
            <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup?channel=${t.channel}`} className="tap" aria-current={t.current ? "page" : undefined}>
              {t.current ? <strong>{t.label}</strong> : t.label}
            </Link>
            {t.state !== null ? <span className="hint"> · {t.state}</span> : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
