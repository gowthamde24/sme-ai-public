/**
 * One row of tabs per page (owner, 13 Nov), and the row of a menu item should not show the app's internal structure (product audit, Leads): the pages people use every day stay in the row, the rest sit under "More", and a page that only repeats a button of the screen is not a tab at all (it stays reachable from that button and by its address).
 * A page that is open is always drawn as a tab, so the person sees where they are.
 */
const OUT_OF_THE_ROW: Record<string, readonly string[]> = { "v6-leads": ["import"] }; // "Add leads": the big "Add leads" button on the Leads screen does the same
const UNDER_MORE: Record<string, readonly string[]> = { "v6-leads": ["map", "retailers", "sites"], "v6-campaigns": ["offerconsent", "campaigns", "calllist", "tasks"] }; // Campaigns: Campaigns | Rules, and under More the payment reminders, the call list and the tasks (owner, 17 Nov)

export function splitTabs<T extends { id: string }>(rowId: string | null, pages: readonly T[], activeId: string): { shown: T[]; more: T[] } {
  const out = OUT_OF_THE_ROW[rowId ?? ""] ?? [];
  const under = UNDER_MORE[rowId ?? ""] ?? [];
  const shown: T[] = [];
  const more: T[] = [];
  for (const p of pages) {
    if (p.id === activeId) shown.push(p);
    else if (out.includes(p.id)) continue;
    else if (under.includes(p.id)) more.push(p);
    else shown.push(p);
  }
  return { shown, more };
}
