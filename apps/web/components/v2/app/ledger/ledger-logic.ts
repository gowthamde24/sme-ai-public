import type { SummaryRowOut } from "@contracts";

/** Pure helpers of the money screens (jobs CO, CS): totals over the customers of the summary, and the buckets of the ageing in a fixed order. Nothing here computes what a person owes; the ledger's own answers are added up. */
export const BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function totals(rows: readonly SummaryRowOut[]) {
  const ageing: Record<Bucket, number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let outstanding = 0;
  let overdue = 0;
  let over = 0;
  for (const r of rows) {
    outstanding += r.outstanding_paise;
    overdue += r.overdue_paise;
    if (r.over_limit) over += 1;
    for (const b of BUCKETS) ageing[b] += r.ageing[b];
  }
  return { outstanding, overdue, over, ageing };
}

/** The share (0 to 100, whole) of a bucket in the total, for the bar. */
export const share = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((part / whole) * 100))));

export const today = (ms: number): string => new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
