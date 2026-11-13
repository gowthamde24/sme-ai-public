import { readJar, writeJar } from "@/lib/mock/jar";

/**
 * The TEST state of the Billing page (BALANCE_SCREENS=mock): what this browser "paid" and whether the free ₹50 was claimed, in ONE small cookie, checked on every read. Nothing is charged, sent or stored on a server. Money is integer paise.
 * The baseline is the made-up ₹1,550 of the side menu's business card. SERVER ONLY.
 */
export const COOKIE = "sme_billing_mock";
export const BASE_PAISE = 155_000;
export const FREE_START_PAISE = 5_000;
export const TOPUP_CHOICES = [50_000, 100_000, 200_000, 500_000] as const;
export type MockTopup = { id: string; at: string; paise: number };
export type MockState = { freeStart: boolean; topups: MockTopup[] };
export const NOTHING: MockState = { freeStart: false, topups: [] };
const MAX_TOPUPS = 6;

export function parseState(v: unknown): MockState | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.freeStart !== "boolean" || !Array.isArray(o.topups) || o.topups.length > MAX_TOPUPS) return null;
  const topups: MockTopup[] = [];
  for (const t of o.topups) {
    if (typeof t !== "object" || t === null) return null;
    const x = t as Record<string, unknown>;
    if (typeof x.id !== "string" || !/^[a-z0-9-]{4,40}$/.test(x.id) || typeof x.at !== "string" || Number.isNaN(Date.parse(x.at)) || !(TOPUP_CHOICES as readonly unknown[]).includes(x.paise)) return null;
    topups.push({ id: x.id, at: x.at, paise: x.paise as number });
  }
  return { freeStart: o.freeStart, topups };
}

export const paiseOf = (s: MockState): number => BASE_PAISE + (s.freeStart ? FREE_START_PAISE : 0) + s.topups.reduce((a, t) => a + t.paise, 0);
export const readState = (): Promise<MockState> => readJar(COOKIE, parseState, NOTHING);
export async function keep(next: MockState): Promise<boolean> {
  return writeJar(COOKIE, next, 7);
}
