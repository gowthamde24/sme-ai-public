import type { AskConsentResult } from "@/lib/api/ask-consent";
import type { ActionStatus } from "@/lib/api/turns";
import type { Search } from "@/lib/lead-finder/types";

import { isFinderCard, isFinderSearch } from "./lead-finder-cards";
import type { Exchange } from "./use-ask-session";

/** The conversation panel's side calls (the plan's Yes / No, the Lead Finder card's OK / Cancel, the history), through this workspace's own route `<base>/conversation`: the person's token never reaches the browser. Anything unclear is a closed word. */
export type ConversationItem = { id: string; title: string; updatedAt: string; messageCount: number; lastText: string };
type History = { role: "user" | "assistant"; text: string; kind: string | null; action: { actionId: string; status: ActionStatus } | null; sources: { label: string }[]; leadFinder?: unknown };

async function call(base: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetcher(`${base}/conversation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ConfirmOutcome = { ok: true; status: "confirmed" | "declined" } | { ok: false; error: "mfa" | "expired" | "state" | "forbidden" | "second" | "cap" | "down" };
export async function confirmPlan(base: string, actionId: string, decision: "yes" | "no", second = false, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<ConfirmOutcome> {
  const json = await call(base, { op: "confirm", actionId, decision, ...(second && decision === "yes" ? { secondConfirm: true } : {}) }, fetcher);
  if (!isRec(json)) return { ok: false, error: "down" };
  if (json.ok === true && (json.status === "confirmed" || json.status === "declined")) return { ok: true, status: json.status };
  const e = json.error;
  return { ok: false, error: e === "mfa" || e === "expired" || e === "state" || e === "forbidden" || e === "second" || e === "cap" ? e : "down" };
}

/**
 * "Ask first" on a plan that waits for its yes (owner, 14 Nov 2026): `whatsapp` = a "reply OK" message to the people whose consent is unknown (NOT consent until they agree), `owner_confirms` = "I confirm they agreed" (recorded; the plan is made again: the answer carries the NEW plan card). Owner only. The answer is numbers and closed codes.
 */
export type AskPlanOutcome = { ok: true; result: AskConsentResult } | { ok: false; error: "state" | "nobody" | "forbidden" | "down" };
export async function askConsentPlan(base: string, actionId: string, how: "whatsapp" | "owner_confirms", fetcher: typeof fetch = (...a) => fetch(...a)): Promise<AskPlanOutcome> {
  const json = await call(base, { op: "ask_consent", actionId, how }, fetcher);
  if (!isRec(json)) return { ok: false, error: "down" };
  if (json.ok === true && isRec(json.result)) {
    const r = json.result;
    return { ok: true, result: { how: r.how === "owner_confirms" ? "owner_confirms" : "whatsapp", asked: Number(r.asked ?? 0), queued: typeof r.queued === "number" ? r.queued : null, blocked: typeof r.blocked === "number" ? r.blocked : null, blockedReasons: isRec(r.blockedReasons) ? (Object.fromEntries(Object.entries(r.blockedReasons).filter((e): e is [string, number] => typeof e[1] === "number")) as Record<string, number>) : {}, templateStatus: typeof r.templateStatus === "string" ? r.templateStatus : null, newAction: isRec(r.newAction) ? r.newAction : null, newTaskId: typeof r.newTaskId === "string" ? r.newTaskId : null } };
  }
  const e = json.error;
  return { ok: false, error: e === "state" || e === "nobody" || e === "forbidden" ? e : "down" };
}

/**
 * The Lead Finder card's OK (the search runs there and then; the answer is the result card) or Cancel (a planned search only). Owner and Admin; the API checks again. A refusal is a closed word: `cap` (today's searches are used up),
 * `state` (the search was cancelled), `off` (the Lead Finder is switched off or not for this business), `plan` (the plan, Lead Desk, does not have it: part of AI Workforce), `forbidden`, `down`.
 */
export type FinderOutcome = { ok: true; search: Search } | { ok: false; error: "cap" | "state" | "off" | "plan" | "forbidden" | "down" };
export async function decideSearch(base: string, searchId: string, decision: "approve" | "cancel", fetcher: typeof fetch = (...a) => fetch(...a)): Promise<FinderOutcome> {
  const json = await call(base, { op: decision === "approve" ? "lf_approve" : "lf_cancel", searchId }, fetcher);
  if (!isRec(json)) return { ok: false, error: "down" };
  if (json.ok === true && isFinderSearch(json.search) && json.search.id === searchId) return { ok: true, search: json.search };
  const e = json.error;
  return { ok: false, error: e === "cap" || e === "state" || e === "off" || e === "plan" || e === "forbidden" ? e : "down" };
}

export async function listHistory(base: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<ConversationItem[] | null> {
  const json = await call(base, { op: "list" }, fetcher);
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  return json.items.filter(isRec).map((x) => ({ id: String(x.id), title: String(x.title ?? ""), updatedAt: String(x.updatedAt ?? ""), messageCount: Number(x.messageCount ?? 0), lastText: String(x.lastText ?? "") }));
}

export async function archiveHistory(base: string, id: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  const json = await call(base, { op: "archive", id }, fetcher);
  return isRec(json) && json.ok === true;
}

/** The messages of one conversation as the thread keeps them: a question and its answer make one exchange; a message the router answered with a plan carries its state, and one that showed a Lead Finder card carries the card (its search's state now). */
export async function openHistory(base: string, id: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<Exchange[] | null> {
  const json = await call(base, { op: "open", id }, fetcher);
  if (!isRec(json) || !Array.isArray(json.messages)) return null;
  const out: Exchange[] = [];
  let asked = "";
  for (const m of json.messages.filter(isRec) as unknown as History[]) {
    if (m.role === "user") {
      if (asked !== "") out.push({ asked, heardByVoice: false, answer: "", sources: [], drafts: [], errorCode: null, failed: false, task: null });
      asked = String(m.text).slice(0, 4000);
    } else {
      const plan = m.action ? { actionId: m.action.actionId, title: String(m.text).slice(0, 300), summary: "", steps: [], count: null, channel: null, estimate: null, needsSecondFactor: false, expiresAt: "", status: m.action.status } : null;
      out.push({ asked, heardByVoice: false, answer: plan ? "" : String(m.text).slice(0, 12_000), sources: (m.sources ?? []).slice(0, 8).map((s) => ({ label: String(s.label), href: null })), drafts: [], errorCode: null, failed: false, task: null, plan, leadFinder: isFinderCard(m.leadFinder) ? m.leadFinder : null });
      asked = "";
    }
  }
  if (asked !== "") out.push({ asked, heardByVoice: false, answer: "", sources: [], drafts: [], errorCode: null, failed: false, task: null });
  return out;
}
