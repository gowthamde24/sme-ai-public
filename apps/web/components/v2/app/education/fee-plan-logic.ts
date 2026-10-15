import { rupeesToPaise } from "@/lib/money";

/** The pure half of the fee plan form (job CS): the academic year the plan is for, and the reading of the typed lines into what the API takes. Nothing here works out a fee: it reads what a person typed and says what is wrong with it. */
export const HEADS = ["tuition", "admission", "transport", "hostel", "exam", "books", "other"] as const;
export type Head = (typeof HEADS)[number];
export const MAX_LINES = 100;
export const MAX_LINE_PAISE = 100_000_000;
export const MAX_CAP_PAISE = 1_000_000_000;

/** `2026-27`: the academic year a day falls in, given the month the year starts (1 to 12). A day before the start month belongs to the year that began the year before. */
export function academicYearOf(day: string, startMonth: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const from = m >= startMonth ? y : y - 1;
  return `${from}-${String((from + 1) % 100).padStart(2, "0")}`;
}

export const isAcademicYear = (v: string): boolean => {
  const hit = /^(20\d{2})-(\d{2})$/.exec(v);
  return hit !== null && (Number(hit[1]) + 1) % 100 === Number(hit[2]);
};

export type LineDraft = { head: Head; no: string; due: string; amount: string };
export type LineIn = { head: Head; instalment_no: number; due_date: string; amount_paise: number };
export type LinesResult = { ok: true; lines: LineIn[]; total: number } | { ok: false; reason: "none" | "many" | "no" | "due" | "amount" | "twice"; row: number };

const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export function readLines(drafts: readonly LineDraft[]): LinesResult {
  if (drafts.length === 0) return { ok: false, reason: "none", row: 0 };
  if (drafts.length > MAX_LINES) return { ok: false, reason: "many", row: 0 };
  const seen = new Set<string>();
  const lines: LineIn[] = [];
  let total = 0;
  for (const [i, d] of drafts.entries()) {
    const n = Number(d.no);
    if (!Number.isInteger(n) || n < 1 || n > 60) return { ok: false, reason: "no", row: i + 1 };
    if (!validDay(d.due)) return { ok: false, reason: "due", row: i + 1 };
    const paise = rupeesToPaise(d.amount, MAX_LINE_PAISE);
    if (paise === null || paise < 1) return { ok: false, reason: "amount", row: i + 1 };
    const key = `${d.head}:${n}`;
    if (seen.has(key)) return { ok: false, reason: "twice", row: i + 1 };
    seen.add(key);
    lines.push({ head: d.head, instalment_no: n, due_date: d.due, amount_paise: paise });
    total += paise;
  }
  return { ok: true, lines, total };
}

export type LateDraft = { kind: "none" | "fixed" | "per_day"; amount: string; grace: string; cap: string };
export type LateResult = { ok: true; kind: "none" | "fixed" | "per_day"; paise: number | null; grace: number; cap: number | null } | { ok: false; reason: "amount" | "grace" | "cap" };

export function readLate(d: LateDraft): LateResult {
  if (d.kind === "none") return { ok: true, kind: "none", paise: null, grace: 0, cap: null };
  const paise = rupeesToPaise(d.amount, MAX_LINE_PAISE);
  if (paise === null || paise < 1) return { ok: false, reason: "amount" };
  const grace = d.grace.trim() === "" ? 0 : Number(d.grace);
  if (!Number.isInteger(grace) || grace < 0 || grace > 60) return { ok: false, reason: "grace" };
  let cap: number | null = null;
  if (d.kind === "per_day" && d.cap.trim() !== "") {
    cap = rupeesToPaise(d.cap, MAX_CAP_PAISE);
    if (cap === null || cap < 1) return { ok: false, reason: "cap" };
  }
  return { ok: true, kind: d.kind, paise, grace, cap };
}
