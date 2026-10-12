import Link from "next/link";

import { makeT, type Words } from "@/components/v2/app/words";
import type { ChannelTab } from "./followup-logic";
import { hintInline, link, tabList } from "@/components/v2/app/ui";

/**
 * The channels of one lead as links (E-mail, then WhatsApp): the address names the channel, so the page stays a server page, works without scripts and can be bookmarked. The current tab is marked;
 * each tab says whether its channel is open or why not, in closed words (no state at all when the API did not report one). Nothing here sends anything.
 */
export function ChannelTabs({ tenantId, leadId, tabs, words }: { tenantId: string; leadId: string; tabs: ChannelTab[]; words?: Words }) {
  const t = makeT(words);
  return (
    <nav aria-label={t("fu.channel")}>
      <ul className={tabList}>
        {tabs.map((tab) => (
          <li key={tab.channel}>
            <Link href={`/app/tenants/${tenantId}/leads/${leadId}/followup?channel=${tab.channel}`} className={link} aria-current={tab.current ? "page" : undefined}>
              {tab.current ? <strong>{tab.label}</strong> : tab.label}
            </Link>
            {tab.state !== null ? <span className={hintInline}> · {tab.state}</span> : null}
          </li>
        ))}
      </ul>
    </nav>
  );
}
