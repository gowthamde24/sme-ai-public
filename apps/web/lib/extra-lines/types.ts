/**
 * Extra lines (owner, 26 Nov 2026; C1's `GET/POST /v1/tenants/{t}/extra-lines`, docs/contracts/extra-lines.md): a workspace's "calls at once" are 2 for each phone number plus the extra lines the Owner bought,
 * Rs 149 a month each, taken from the credits. Pure: no fetch, no React. The words of a refusal are closed words; the screen says them in plain language, never the server's text.
 */
export const LINE_STATUSES = ["active", "grace", "paused", "ended"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
/** One extra line: `working` = it counts as a call at once now (paid, and its channel is bought); `paidUntil` = the end of the paid month (an ISO time). */
export type ExtraLine = { id: string; status: LineStatus; working: boolean; paidUntil: string; cancelAtEnd: boolean; graceUntil: string | null };
export type ExtraLines = { enabled: boolean; priceRupees: number; cap: number; numbers: number; included: number; total: number; canAdd: boolean; extra: ExtraLine[] };

/** Why a line could not be added or changed: closed words (`409 lines_unavailable`). */
export const REFUSAL_REASONS = ["paused", "at_limit", "no_number", "not_enough_credits", "not_found", "unavailable"] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
export type Refusal = { ok: false; error: "invalid" | "forbidden" | "step_up" | "unavailable" | "down"; reason?: RefusalReason };
export type LineResult = { ok: true } | Refusal;
/** One move of the card, ready to run (the action bound to its arguments). */
export type LineMove = () => Promise<LineResult>;
/** What the card can do (server actions bound to the workspace): add a line with the key of one press, cancel a line, keep it. */
export type LineActions = { add: (key: string) => Promise<LineResult>; cancel: (id: string) => Promise<LineResult>; keep: (id: string) => Promise<LineResult> };

/** One press of "Add the line" has one key: the same key twice is the same line (the server keeps it). 8 to 64 letters, digits, dash and underscore. */
export const isKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
export const isLineId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The most lines a workspace is given by default; Stack19 raises it for one workspace (the API says the real number in `cap`). */
export const DEFAULT_CAP = 20;
export const MOCK_PRICE = 149;
export const MOCK_CREDITS = 500;   // the test screen's made-up credits: three lines are paid, the fourth is refused ("not enough credits")

/** The test screen's answer (EXTRA_LINES=mock) for a workspace with one number, `n` extra lines bought, and `cancelled` of them cancelled for the end of the month. */
export function mockOverview(n: number, cancelled: number, now: number = Date.now()): ExtraLines {
  const paidUntil = new Date(now + 26 * 24 * 3600 * 1000).toISOString();
  const extra: ExtraLine[] = Array.from({ length: n }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, status: "active", working: true, paidUntil, cancelAtEnd: i < cancelled, graceUntil: null }));
  return { enabled: true, priceRupees: MOCK_PRICE, cap: DEFAULT_CAP, numbers: 1, included: 2, total: 2 + n, canAdd: 2 + n < DEFAULT_CAP, extra };
}
