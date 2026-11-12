/**
 * At most this many reads of the API at the same time for one signed-in person (C1's Phase 1, owner approved 12 Nov 2026): the Today page alone asks for about thirty things at once, and the API's page limiter (12 at a time)
 * answered 40 of them "busy" on staging (14:03 UTC, 12 Nov). The rest wait here, in the order they were asked, and go out as soon as one finishes; nothing is dropped. SERVER ONLY (client.ts loads this file only behind
 * `typeof window === "undefined"`, so no browser ever gets it). Reads only (GET): a save is never made to wait behind a page's reads. API_READS_PER_USER changes the number (default 8, below the API's 12 so a poll or a
 * second tab still fits).
 */
const MAX = (): number => {
  const n = Number(process.env.API_READS_PER_USER);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 8;
};
type Lane = { active: number; waiting: Array<() => void> };
const lanes = new Map<string, Lane>();
const NOTHING = (): void => undefined;

/** Resolves with the release function once this read may go out. A slot is handed straight to the next waiting read, so the count never dips between two reads. */
export async function acquireRead(token: string, method: string | undefined): Promise<() => void> {
  if (method !== undefined && method !== "GET") return NOTHING;
  let lane = lanes.get(token);
  if (!lane) {
    lane = { active: 0, waiting: [] };
    lanes.set(token, lane);
  }
  const mine = lane;
  if (mine.active < MAX()) mine.active += 1;
  else await new Promise<void>((resolve) => mine.waiting.push(resolve));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = mine.waiting.shift();
    if (next) next();
    else {
      mine.active -= 1;
      if (mine.active === 0 && lanes.get(token) === mine) lanes.delete(token);
    }
  };
}
