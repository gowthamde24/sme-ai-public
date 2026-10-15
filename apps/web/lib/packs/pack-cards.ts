import { addDays, dayInIndia } from "@/components/v2/app/deliveries/trip-logic";
import { ApiAuthError } from "@/lib/api/client";
import { listTrips } from "@/lib/api/deliveries";
import { getLedgerSummary } from "@/lib/api/ledger";
import { listMaterialQuotes } from "@/lib/api/materials";
import { settle } from "@/lib/api/part";
import type { WorkspacePack } from "@/lib/packs/types";

import { hasModule } from "./has";

/**
 * The cards a business type adds to Today (blueprint 6, jobs CO and CS): construction shows today's trips, quotes waiting and what falls due this week; education will show today's collection, reminders running and
 * campus visits (job CS). A card exists only when the business type has the module behind it and the person's role may read the numbers; each card is read on its own and says "not available" when its read fails, so one
 * slow part never blanks Today. The numbers are what the API holds (counted, never guessed); the money is the ledger's own. Nothing here names a business type.
 */
export type PackCard = {
  id: string;
  /** The words (keys of the string store) and their values; `value` null = the read failed. */
  titleKey: string;
  value: string | null;
  subKey: string | null;
  subVars: Record<string, string | number>;
  href: string;
  tone: "neutral" | "amber" | "red" | "green";
};

type Role = "owner" | "admin" | "sales" | "viewer";
export type PackCardInput = { accessToken: string; tenantId: string; role: Role; pack: Pick<WorkspacePack, "modules"> | null; now: number; formatMoney: (paise: number) => string };

const money = (cards: PackCardInput) => cards.formatMoney;

export async function readPackCards(input: PackCardInput): Promise<PackCard[]> {
  const { accessToken, tenantId, role, pack, now } = input;
  if (!pack || role === "viewer") return [];
  const base = `/app/tenants/${tenantId}`;
  const today = dayInIndia(now);
  const week = addDays(today, 7);
  const jobs: Promise<PackCard | null>[] = [];

  if (hasModule(pack, "deliveries")) {
    jobs.push(
      settle(() => listTrips(accessToken, tenantId, { date: today })).then((r): PackCard => {
        if (!r.ok) return { id: "trips", titleKey: "today.pack.trips.title", value: null, subKey: null, subVars: {}, href: `${base}/orders/trips`, tone: "neutral" };
        const items = r.data.items;
        const moving = items.filter((t) => t.status === "on_the_way").length;
        const done = items.filter((t) => t.status === "delivered").length;
        const problems = items.filter((t) => t.status === "problem").length;
        return { id: "trips", titleKey: "today.pack.trips.title", value: String(items.length), subKey: items.length === 0 ? "today.pack.trips.none" : problems > 0 ? "today.pack.trips.problem" : "today.pack.trips.sub", subVars: { moving, done, problems }, href: `${base}/orders/trips`, tone: problems > 0 ? "red" : "neutral" };
      }),
    );
  }
  if (hasModule(pack, "materials")) {
    jobs.push(
      settle(() => listMaterialQuotes(accessToken, tenantId, { limit: 50 })).then((r): PackCard => {
        if (!r.ok) return { id: "quotes", titleKey: "today.pack.quotes.title", value: null, subKey: null, subVars: {}, href: `${base}/quotes`, tone: "neutral" };
        const drafts = r.data.items.filter((q) => q.status === "draft").length;
        return { id: "quotes", titleKey: "today.pack.quotes.title", value: String(drafts), subKey: drafts === 0 ? "today.pack.quotes.none" : role === "sales" ? "today.pack.quotes.sales" : "today.pack.quotes.sub", subVars: { n: drafts }, href: `${base}/quotes`, tone: drafts > 0 ? "amber" : "neutral" };
      }),
    );
  }
  if (hasModule(pack, "dues") && !hasModule(pack, "fees")) {
    jobs.push(
      settle(() => getLedgerSummary(accessToken, tenantId, { party: "company", limit: 100 })).then((r): PackCard => {
        if (!r.ok) return { id: "dues", titleKey: "today.pack.dues.title", value: null, subKey: null, subVars: {}, href: `${base}/dues`, tone: "neutral" };
        let dueWeek = 0;
        let overdue = 0;
        for (const row of r.data.items) {
          overdue += row.overdue_paise;
          for (const o of row.open_invoices) if (o.due_date >= today && o.due_date <= week) dueWeek += o.open_paise;
        }
        return { id: "dues", titleKey: "today.pack.dues.title", value: money(input)(dueWeek), subKey: overdue > 0 ? "today.pack.dues.overdue" : "today.pack.dues.fine", subVars: { amount: money(input)(overdue) }, href: `${base}/dues`, tone: overdue > 0 ? "red" : "neutral" };
      }),
    );
  }
  const out = (await Promise.all(jobs.map((j) => j.catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null))))).filter((c): c is PackCard => c !== null);
  return out;
}
