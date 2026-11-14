import { readJar, writeJar } from "@/lib/mock/jar";

import { EMPTY_MOCK, type MockState } from "./staff-fixtures";

/**
 * What the console's MOCK source remembers between clicks (STAFF_CONSOLE=mock): a reply, a note, a status or assignee change, a paused assistant, a goodwill credit and a fresh authenticator code, in ONE small cookie (lib/mock/jar.ts),
 * checked on every read, never trusted. It is only the made-up sample's memory: with the real API none of it is used. A value that does not fit the cookie is refused, never cut. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_staff_mock";
const MAX_MSGS = 4;
const MAX_BODY = 160;

export interface MockJar {
  read(): Promise<MockState>;
  /** true when kept. */
  write(state: MockState): Promise<boolean>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMockState(value: unknown): MockState | null {
  if (!isRecord(value)) return null;
  const tickets: MockState["tickets"] = {};
  if (isRecord(value.tickets)) {
    for (const [k, v] of Object.entries(value.tickets)) {
      if (!/^[0-4]$/.test(k) || !isRecord(v)) continue;
      const msgs = Array.isArray(v.msgs)
        ? v.msgs.flatMap((m): { k: "r" | "n"; b: string; t: number }[] => (isRecord(m) && (m.k === "r" || m.k === "n") && typeof m.b === "string" && typeof m.t === "number" ? [{ k: m.k, b: m.b.slice(0, 4000), t: m.t }] : [])).slice(-MAX_MSGS)
        : [];
      tickets[k] = { ...(v.status === "open" || v.status === "waiting" || v.status === "closed" ? { status: v.status } : {}), ...(v.assignee === "me" || v.assignee === "none" ? { assignee: v.assignee } : {}), ...(msgs.length ? { msgs } : {}) };
    }
  }
  const paused = Array.isArray(value.paused) ? value.paused.filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, 8) : [];
  const credited: Record<string, number> = {};
  if (isRecord(value.credited)) for (const [k, v] of Object.entries(value.credited)) if (k.length <= 40 && typeof v === "number" && Number.isFinite(v) && v >= 0) credited[k] = v;
  return { tickets, paused, credited, fresh: typeof value.fresh === "number" ? value.fresh : 0 };
}

/** The message a mock thread keeps is cut to what a cookie can hold (the real API keeps the whole thing). */
export const mockBody = (body: string): string => (body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body);

export const cookieJar: MockJar = {
  read: () => readJar(MOCK_COOKIE, parseMockState, EMPTY_MOCK),
  write: (state) => writeJar(MOCK_COOKIE, state, 1),
};
