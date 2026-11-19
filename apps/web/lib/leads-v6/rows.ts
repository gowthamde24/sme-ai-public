import type { DeskLead } from "@/lib/lead-desk/leads";
import { leadTitle } from "@/lib/lead-desk/leads";
import type { Prospect } from "@/lib/lead-finder/types";

import { leadChip, prospectChip, type LeadChip, type LeadSignals } from "./chips";

/**
 * One line of the Leads table (design system v6): a lead of Lead Desk or a business the Lead Finder found nearby, with the six-chip state, where it came from and what it wants. `key` is what the address carries to open the right panel
 * (`?open=`): `l-<id>` for a lead, `p-<id>` for a found business. Pure.
 */
export type LeadRow = {
  key: string;
  kind: "lead" | "found";
  id: string;
  name: string;
  chip: LeadChip;
  /** The lead source tag (indiamart, meta_lead_ads...), or null for a found business (its source is the Lead Finder). */
  source: string | null;
  /** True for a business the Lead Finder found near the shop. */
  nearby: boolean;
  /** What the lead wants and where, in a few words (or a found business's kind and area). */
  line: string;
  /** ISO time the lead arrived or was found. */
  at: string;
  hot: boolean;
  isNew: boolean;
  phone: string | null;
  ownerUserId: string | null;
};

const join = (parts: ReadonlyArray<string | null | undefined>): string => parts.filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" · ");

export function rowFromLead(l: DeskLead, signals: LeadSignals, newEnquiry: string): LeadRow {
  const p = l.profile;
  return {
    key: `l-${l.id}`,
    kind: "lead",
    id: l.id,
    name: leadTitle(l.name, l.phone, newEnquiry),
    chip: leadChip(l.status, signals),
    source: l.source,
    nearby: false,
    line: join([p?.need, p?.quantity, p?.area ?? p?.city]),
    at: l.createdAt,
    hot: l.hot,
    isNew: l.isNew === true || l.status === "new" || l.status === "unknown",
    phone: l.phone ?? null,
    ownerUserId: l.ownerUserId,
  };
}

export function rowFromProspect(p: Prospect, unavailable: string): LeadRow {
  return {
    key: `p-${p.id}`,
    kind: "found",
    id: p.id,
    name: p.name ?? unavailable,
    chip: prospectChip(p.status),
    source: null,
    nearby: true,
    line: join([p.category, p.area]),
    at: p.createdAt,
    hot: false,
    isNew: p.status === "new" || p.status === "needs_owner",
    phone: p.phone,
    ownerUserId: null,
  };
}

/** Newest first; the stable order of equal times is the order given. */
export function sortRows(rows: readonly LeadRow[]): LeadRow[] {
  return [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The words a person typed, matched against the name, what it wants and the phone digits. */
export function searchRows(rows: readonly LeadRow[], q: string): LeadRow[] {
  const t = q.trim().toLowerCase();
  if (t === "") return [...rows];
  return rows.filter((r) => `${r.name} ${r.line} ${r.phone ?? ""}`.toLowerCase().includes(t));
}

/** Where a row came from, as the address carries it (`?source=`): the lead source tag, `finder` for a business the Lead Finder found, `none` for a lead with no source. (JOBS: "from [everywhere]".) */
export const sourceKey = (r: Pick<LeadRow, "kind" | "source">): string => (r.kind === "found" ? "finder" : (r.source ?? "none"));
/** The rows from one place (null = everywhere). */
export const fromSource = (rows: readonly LeadRow[], source: string | null): LeadRow[] => (source === null ? [...rows] : rows.filter((r) => sourceKey(r) === source));
/** The places the rows came from, each once, in the order first seen. */
export function sourcesOf(rows: readonly LeadRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (!out.includes(sourceKey(r))) out.push(sourceKey(r));
  return out;
}

/** Visits tell two of the chips: a visit that is booked, confirmed, here or done = Visit booked; one that ended in a purchase = Won. */
export function signalsFromVisits(visits: ReadonlyArray<{ lead_id: string; status: string; outcome: string | null }>): Map<string, LeadSignals> {
  const out = new Map<string, LeadSignals>();
  for (const v of visits) {
    if (v.status === "cancelled" || v.status === "no_show") continue;
    const s = out.get(v.lead_id) ?? {};
    s.visitBooked = true;
    if (v.outcome === "bought") s.won = true;
    out.set(v.lead_id, s);
  }
  return out;
}
