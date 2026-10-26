import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import * as api from "@/lib/api/lead-playbook";
import { readJar, writeJar } from "@/lib/mock/jar";
import { leadsScreens } from "@/lib/screens/flag";

import { MOCK_TEMPLATES } from "./templates";
import { parseEdit, type PDone, type PlaybookBody, type PlaybookRead, type PlaybookRefusal } from "./playbook";

/**
 * Where the lead playbook lives (night 4, part A1): `mock` = made-up defaults plus the owner's edit in a cookie, `on` = the API, `off` = not there. A deep business type (sarees, building materials, a school) has no template: the playbook
 * is `null` and the screens say so. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string };
const COOKIE = "sme_playbook_mock";
type Saved = { goalAsk: string; questions: { field: string; ask: string; required: boolean }[] } | null;

export function refusalOf(error: unknown): PlaybookRefusal {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.code === "no_template") return "no_template";
    if (error.reason === "price_or_promise") return "price_or_promise";
    if (error.status === 403) return "forbidden";
    if (error.status === 422 || error.status === 400) return "invalid";
    if (error.status === 404) return "not_available";
  }
  return "down";
}

const QUESTIONS = [
  { field: "need", ask: "What are you looking for?", required: true },
  { field: "budget", ask: "What budget range are you comfortable with?", required: true },
  { field: "when", ask: "When do you want to start?", required: false },
  { field: "area", ask: "Which area or city is it for?", required: false },
];
function defaultsFor(pack: string): PlaybookBody {
  const t = MOCK_TEMPLATES.find((x) => x.packId === pack);
  const goal = t?.goalLabel.en ?? "Talk and find out their interest";
  return {
    goalAsk: `${goal} when they are ready.`,
    questions: QUESTIONS,
    objections: [{ code: "too_expensive", hears: ["too costly", "price is high"], answer: "I understand. Our team can share the details and explain what is included." }],
    followups: [{ when: "no_answer", afterMinutes: 30, channel: "call", maxAttempts: 3, message: null }, { when: "interested", afterMinutes: 5, channel: "whatsapp", maxAttempts: 1, message: "Thank you for your time. We will send the details here." }],
    raw: {},
  };
}
const SAFETY = ["The assistant says it is an AI assistant on every call.", "It states only facts you approved, and never a price you did not approve.", "It stops when someone says no or sends STOP."];

/** The playbook in force (the saved one, else the template's), or null when it cannot be read. `packId` is the workspace's business type. */
export async function readPlaybook(ctx: Ctx, packId: string | null): Promise<PlaybookRead | null> {
  const mode = leadsScreens();
  if (mode === "off") return null;
  if (mode === "mock") {
    const pack = packId !== null && MOCK_TEMPLATES.some((x) => x.packId === packId) ? packId : MOCK_TEMPLATES[0].packId;
    const defaults = defaultsFor(pack);
    const saved = await readJar<Saved>(COOKIE, (v) => (typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as { goalAsk?: unknown }).goalAsk === "string" && Array.isArray((v as { questions?: unknown }).questions) ? (v as Saved) : null), null);
    const parsed = saved ? parseEdit(saved, null) : null;
    const playbook = parsed && parsed.ok ? { ...defaults, goalAsk: parsed.goalAsk, questions: parsed.questions } : defaults;
    return { templatePack: pack, saved: parsed !== null && parsed.ok, playbook, defaults, safety: SAFETY, updatedAt: null };
  }
  try {
    return await api.getPlaybook(ctx.token, ctx.tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/** Save the goal sentence and the questions. The Owner, with the second factor (the API asks). `allowed` = the fields the business type has (a question names one of them once). */
export async function savePlaybook(ctx: Ctx, current: PlaybookRead, input: unknown): Promise<PDone<PlaybookRead>> {
  const mode = leadsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (current.playbook === null) return { ok: false, error: "no_template" };
  const allowed = new Set([...(current.defaults?.questions ?? []), ...current.playbook.questions].map((q) => q.field));
  const edit = parseEdit(input, allowed);
  if (!edit.ok) return edit;
  if (mode === "mock") {
    if (!(await writeJar(COOKIE, { goalAsk: edit.goalAsk, questions: edit.questions }, 30))) return { ok: false, error: "invalid" };
    return { ok: true, value: { ...current, saved: true, playbook: { ...current.playbook, goalAsk: edit.goalAsk, questions: edit.questions } } };
  }
  try {
    return { ok: true, value: await api.putPlaybook(ctx.token, ctx.tenantId, current.playbook, edit) };
  } catch (error) {
    return { ok: false, error: refusalOf(error) };
  }
}

export async function resetToTemplate(ctx: Ctx, current: PlaybookRead): Promise<PDone<PlaybookRead>> {
  const mode = leadsScreens();
  if (mode === "off") return { ok: false, error: "not_available" };
  if (mode === "mock") {
    await writeJar(COOKIE, null, 0);
    return { ok: true, value: { ...current, saved: false, playbook: current.defaults } };
  }
  try {
    return { ok: true, value: await api.resetPlaybook(ctx.token, ctx.tenantId) };
  } catch (error) {
    return { ok: false, error: refusalOf(error) };
  }
}
