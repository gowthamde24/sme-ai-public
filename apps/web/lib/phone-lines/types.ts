/**
 * "Calls at once" on the Phone numbers page (owner, 29 Nov 2026; C1's `GET /v1/tenants/{t}/phone-lines`, docs/contracts/calls.md, Owner and Admin): how many calls this deployment lets run together (`total`, at most 20), how many are running now (`in_use`, our own live-call
 * counter) and one tile per line (`open` or `on_call`). The lines are shared by every number of the business. Nothing else is in the answer: no number, no caller. Pure: no fetch, no React.
 */
export const LINE_STATES = ["open", "on_call"] as const;
export type LineState = (typeof LINE_STATES)[number];
export type Line = { n: number; state: LineState };
export type Lines = { total: number; inUse: number; lines: Line[] };
export const MAX_LINES = 20;

/** The test screen's answer (PHONE_LINES_SCREENS=mock): two lines, one on a call (the server always lists the busy lines first). Nothing is read. */
export const MOCK_LINES: Lines = { total: 2, inUse: 1, lines: [{ n: 1, state: "on_call" }, { n: 2, state: "open" }] };

/**
 * The answer, checked: a number of lines that does not add up (more than 20, `in_use` above `total`, a tile count that differs from `total`, two tiles with the same number) is refused, never drawn. The tiles are rebuilt from the counts
 * (the first `in_use` lines are on a call), so a tile the server mislabelled cannot disagree with the number beside it.
 */
export function parseLines(json: unknown): Lines | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const { total, in_use: inUse, lines } = o;
  if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > MAX_LINES) return null;
  if (typeof inUse !== "number" || !Number.isSafeInteger(inUse) || inUse < 0 || inUse > total) return null;
  if (!Array.isArray(lines) || lines.length !== total) return null;
  const seen = new Set<number>();
  for (const row of lines) {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    if (typeof r.n !== "number" || !Number.isSafeInteger(r.n) || r.n < 1 || seen.has(r.n)) return null;
    if (!(LINE_STATES as readonly unknown[]).includes(r.state)) return null;
    seen.add(r.n);
  }
  return { total, inUse, lines: Array.from({ length: total }, (_, i) => ({ n: i + 1, state: i < inUse ? "on_call" : "open" })) };
}
