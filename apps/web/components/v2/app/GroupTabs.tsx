"use client";


import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { word, withPackWords, type Labels } from "./labels";
import { hrefOf, menuOfPage, tabsOf, type NavItem } from "./nav";
import { SectionTabs } from "./parts";
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * The tabs of the menu item a page belongs to (job DQ part 0): Customers is Leads, Customers, Find retailers ...; Chats is the customer chats and the Outbox; Calls is Follow-ups, the call list and Campaigns; Sales is Quotes, Store visits,
 * Orders (and Fees, Admission board, Dues for a school or a builder's merchant); Catalogue is the catalogue, prices and products; Settings is Settings, Team, Office and Integrations. Drawn above the page, only when the item has more than one
 * page the role and the business type are offered. Every page keeps its own address: the tabs are plain links, so nothing moved needs a redirect.
 */
export function GroupTabs({ memberships, labels: given_labels, frame: given }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData }) {
  const { current, active } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const labels = withPackWords(given_labels, frame.pack);
  if (!current || !active) return null;
  const menu = menuOfPage(active.item.id);
  if (!menu) return null;
  const tabs: NavItem[] = tabsOf(menu, current.role, frame.pack);
  if (tabs.length < 2) return null;
  const label = word(labels, "nav.tabs.label", "Parts of this section");
  return (
    <div data-frame="group-tabs" className="mx-auto w-full max-w-[1200px] px-4 md:px-8 print:hidden">
      <SectionTabs label={label} items={tabs.map((t) => ({ key: t.id, label: word(labels, `nav.item.${t.id}`, t.label), href: hrefOf(t, current.id), current: t.id === active.item.id || (t.id === "leaddesk" && active.item.id === "leads") }))} />
    </div>
  );
}

