import { ApiRequestError, apiRequest } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readJar, writeJar } from "@/lib/mock/jar";
import { teachScreens } from "@/lib/screens/flag";

import { ANSWER_MAX, ANSWER_MIN, SOURCES, type Source } from "./limits";

/**
 * "Teach this" (owner, 13 Nov 2026): the corrected answer for a line the assistant said goes into Knowledge, and can be undone. `1` = C1's `POST /v1/tenants/{t}/knowledge/corrections {source, source_id, line_index, corrected_answer}` -> `{id}` and `POST .../corrections/{id}/undo` (an audit entry is C1's);
 * `mock` = a cookie of the browser (staging until the route exists). Every move checks its input again here. The answer text is 2 to 600 characters, plain text, with no markup. Never throws for the browser: it answers a closed word.
 */
export const COOKIE = "sme_corrections_mock";
export { ANSWER_MAX, ANSWER_MIN, SOURCES, type Source } from "./limits";
export type Correction = { id: string; source: Source; sourceId: string; lineIndex: number; answer: string };
export type TeachInput = { source: unknown; sourceId: unknown; lineIndex: unknown; answer: unknown };
export type Taught = { ok: true; id: string } | { ok: false; error: "invalid" | "forbidden" | "not_available" | "down" };

const isSource = (v: unknown): v is Source => typeof v === "string" && (SOURCES as readonly string[]).includes(v);
const MAX_KEPT = 8;

/** A correction as the form sent it, checked: a known source, an id (any id is kept as text up to 64 characters), a line index, an answer of 2 to 600 characters without markup. null = invalid. */
export function checkInput(i: TeachInput): Omit<Correction, "id"> | null {
  if (!isSource(i.source) || typeof i.sourceId !== "string" || i.sourceId.length < 1 || i.sourceId.length > 64 || !/^[\w.-]+$/.test(i.sourceId)) return null;
  if (typeof i.lineIndex !== "number" || !Number.isInteger(i.lineIndex) || i.lineIndex < 0 || i.lineIndex > 10_000) return null;
  if (typeof i.answer !== "string") return null;
  const answer = i.answer.trim();
  if (answer.length < ANSWER_MIN || answer.length > ANSWER_MAX || /[<>]/.test(answer)) return null;
  return { source: i.source, sourceId: i.sourceId, lineIndex: i.lineIndex, answer };
}

const parseKept = (v: unknown): Correction[] | null => {
  if (!Array.isArray(v)) return null;
  return v.filter((c): c is Correction => typeof c === "object" && c !== null && typeof (c as Correction).id === "string" && isSource((c as Correction).source)).slice(-MAX_KEPT);
};

export async function teach(token: string, tenantId: string, input: TeachInput): Promise<Taught> {
  const mode = teachScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  const c = checkInput(input);
  if (!c || !isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const id = crypto.randomUUID();
    const kept = await readJar(COOKIE, parseKept, []);
    return (await writeJar(COOKIE, [...kept, { id, ...c }].slice(-MAX_KEPT))) ? { ok: true, id } : { ok: false, error: "invalid" };
  }
  try {
    const out = await apiRequest(`/v1/tenants/${tenantId}/knowledge/corrections`, token, { method: "POST", body: JSON.stringify({ source: c.source, source_id: c.sourceId, line_index: c.lineIndex, corrected_answer: c.answer }) });
    const id = typeof out === "object" && out !== null && "id" in out ? (out as { id: unknown }).id : null;
    return typeof id === "string" && isCanonicalUuid(id) ? { ok: true, id } : { ok: false, error: "down" };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404 || error.status === 405) return { ok: false, error: "not_available" };
      if (error.status === 422) return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "down" };
  }
}

export async function undo(token: string, tenantId: string, id: unknown): Promise<{ ok: true } | { ok: false; error: "invalid" | "forbidden" | "not_available" | "down" }> {
  const mode = teachScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (typeof id !== "string" || !isCanonicalUuid(id) || !isCanonicalUuid(tenantId)) return { ok: false, error: "invalid" };
  if (mode === "mock") {
    const kept = await readJar(COOKIE, parseKept, []);
    await writeJar(COOKIE, kept.filter((c) => c.id !== id));
    return { ok: true };
  }
  try {
    await apiRequest(`/v1/tenants/${tenantId}/knowledge/corrections/${id}/undo`, token, { method: "POST", body: JSON.stringify({}) });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 403) return { ok: false, error: "forbidden" };
      if (error.status === 404 || error.status === 405) return { ok: false, error: "not_available" };
    }
    return { ok: false, error: "down" };
  }
}
