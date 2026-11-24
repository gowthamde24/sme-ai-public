"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import type { FrameData } from "./contract";
import { useFrameData } from "./frame-store";
import { word, withPackWords, type Labels } from "./labels";
import { activeV6Id, hrefOf, menuGroupsV6, menuOfPage, tabsOf, v6PagesOf, type NavItem, menuItemId, v4OfMenu, v4Sections, v4dRowOf, v4dSections } from "./nav";
import { SectionTabs } from "./parts";
import { splitTabs } from "./tabs-more";

const MoreMenu = dynamic(() => import("./TabsMoreMenu"));
import { useWorkspace, type Membership } from "./use-workspace";

/**
 * The tabs of the menu item a page belongs to (job DQ part 0): Customers is Leads, Customers, Find retailers ...; Chats is the customer chats and the Outbox; Calls is Follow-ups, the call list and Campaigns; Sales is Quotes, Store visits,
 * Orders (and Fees, Admission board, Dues for a school or a builder's merchant); Catalogue is the catalogue, prices and products; Settings is Settings, Team, Office and Integrations. Drawn above the page, only when the item has more than one
 * page the role and the business type are offered. Every page keeps its own address: the tabs are plain links, so nothing moved needs a redirect.
 */
/** On a phone a tab row scrolls sideways, so the current tab is brought into view when the row appears (it may be the last one: the open page is always drawn as a tab, e.g. Payment reminders on the New offer page, owner 18 Nov). A callback ref: the row can appear after the first paint, once the frame's data says v4. */
function toCurrent(el: HTMLDivElement | null): void {
  const row = el?.querySelector("nav");
  const on = row?.querySelector<HTMLElement>('[aria-current="page"]');
  if (row && on) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - 16);
}

export function GroupTabs({ memberships, labels: given_labels, frame: given }: { memberships: readonly Membership[]; labels?: Labels; frame: FrameData }) {
  const { current, active, tab } = useWorkspace(memberships);
  const frame = useFrameData(given);
  const path = usePathname() ?? "";
  const labels = withPackWords(given_labels, frame.pack);
  if (!current || !active) return null;
  // design system v6 (owner, 13 Nov 2026): ONE row of tabs at most, made of the pages of the side-menu row the page belongs to; a single page draws none
  if (frame.ds) {
    const groups = menuGroupsV6(current.role, frame.pack);
    const rowId = activeV6Id(groups, path, tab);
    if (frame.settingsOpen && rowId === "v6-settings") return null; // Settings is one page of sections (owner, 25 Nov): no Settings | Team row
    const item = groups.flatMap((g) => g.items).find((i) => i.id === rowId);
    const pages = item ? v6PagesOf(item).filter((p) => p.id !== "live") : [];
    // Today draws no tab row (the menu already has My assistant): the band comes first (the final Today design)
    // Reports draws none on its own page (owner, 13 Nov 2026: one tab row at most): it has the period row (the other two report pages are links at its foot). My assistant draws its ONE row everywhere (Overview | Train how it talks | Office; owner, 18 Nov 2026)
    if (pages.length < 2 || rowId === "v6-today" || (rowId === "v6-reports" && active.item.id === "report")) return null;
    const { shown, more } = splitTabs(rowId, pages, active.item.id);
    // My assistant row (owner, 18 Nov): the page and the menu say "My assistant", so its first tab says "Overview" (no two tabs, or a tab and the menu, with one name)
    const tabWord = (t: { id: string; label: string }): string => (rowId === "v6-myassistant" && t.id === "myassistant" ? word(labels, "nav.tab.overview", "Overview") : word(labels, `nav.item.${t.id}`, t.label));
    const tabItems = shown.map((t) => ({ key: t.id, label: tabWord(t), href: hrefOf(t, current.id), current: t.id === active.item.id }));
    return (
      <div data-frame="group-tabs" data-tabs="v6" className="mx-auto w-full max-w-[1200px] space-y-1 px-4 md:px-8 print:hidden">
        {more.length > 0 ? (
          <div className="flex items-end gap-2">
            <div ref={toCurrent} className="min-w-0 flex-1">
              <SectionTabs scroll label={word(labels, "nav.tabs.label", "Parts of this section")} items={tabItems} />
            </div>
            <MoreMenu label={word(labels, "nav.more", "More")} items={more.map((t) => ({ key: t.id, label: tabWord(t), href: hrefOf(t, current.id) }))} />
          </div>
        ) : (
          <div ref={toCurrent}>
            <SectionTabs scroll label={word(labels, "nav.tabs.label", "Parts of this section")} items={tabItems} />
          </div>
        )}
      </div>
    );
  }
  const menu = menuOfPage(active.item.id);
  if (!menu) return null;
  // app v4: one customer's or one call's own page draws no page tabs (only the sections): it is one thing, not one of the section's pages
  const own = frame.v4 && /\/(customers|calls)\/[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(path);
  const tabs: NavItem[] = own ? [] : tabsOf(menu, current.role, frame.pack);
  // app v4: first the sections of the page's group (Customers: Leads, Calls, Chats ...), then, when the section has more than one page, its pages
  const group = frame.v4 ? v4OfMenu(menu.id) : null;
  const sections = group ? v4Sections(group, current.role, frame.pack) : [];
  // app v4 on a desktop (1024 px and up): the menu row's own pages are the sections (Leads: Leads, Follow-ups, Store visits), not the five groups' (owner, 7 Nov 2026)
  const drow = frame.v4 ? v4dRowOf(menu.id) : null;
  const dsections = drow ? v4dSections(drow, current.role, frame.pack) : [];
  if (tabs.length < 2 && sections.length < 2 && dsections.length < 2) return null;
  const label = word(labels, "nav.tabs.label", "Parts of this section");
  return (
    <div data-frame="group-tabs" className="mx-auto w-full max-w-[1200px] space-y-1 px-4 md:px-8 print:hidden">
      {dsections.length >= 2 ? (
        <div data-frame="v4d-sections" className="hidden lg:block">
          <SectionTabs label={word(labels, "nav.v4.sections", "Sections")} items={dsections.map((s) => ({ key: s.id, label: word(labels, `nav.item.${s.id}`, s.label), href: hrefOf(s, current.id), current: s.id === menuItemId(menu) }))} />
        </div>
      ) : null}
      {sections.length >= 2 ? (
        <div data-frame="v4-sections" ref={toCurrent} className={frame.v4 ? "lg:hidden" : undefined}>
          <SectionTabs scroll label={word(labels, "nav.v4.sections", "Sections")} items={sections.map((s) => ({ key: s.id, label: word(labels, `nav.item.${s.id}`, s.label), href: hrefOf(s, current.id), current: s.id === menuItemId(menu) }))} />
        </div>
      ) : null}
      {tabs.length >= 2 ? <SectionTabs label={label} items={tabs.map((t) => ({ key: t.id, label: word(labels, `nav.item.${t.id}`, t.label), href: hrefOf(t, current.id), current: t.id === active.item.id }))} /> : null}
    </div>
  );
}

