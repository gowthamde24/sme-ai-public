import type { ActionStatus } from "@/lib/api/turns";
import type { Exchange } from "./use-ask-session";

/** The conversation panel's side calls (the plan's Yes / No, the history), through this workspace's own route `<base>/conversation`: the person's token never reaches the browser. Anything unclear is a closed word. */
export type ConversationItem = { id: string; title: string; updatedAt: string; messageCount: number; lastText: string };
type History = { role: "user" | "assistant"; text: string; kind: string | null; action: { actionId: string; status: ActionStatus } | null; sources: { label: string }[] };

async function call(base: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetcher(`${base}/conversation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type ConfirmOutcome = { ok: true; status: "confirmed" | "declined" } | { ok: false; error: "mfa" | "expired" | "state" | "forbidden" | "down" };
export async function confirmPlan(base: string, actionId: string, decision: "yes" | "no", fetcher: typeof fetch = (...a) => fetch(...a)): Promise<ConfirmOutcome> {
  const json = await call(base, { op: "confirm", actionId, decision }, fetcher);
  if (!isRec(json)) return { ok: false, error: "down" };
  if (json.ok === true && (json.status === "confirmed" || json.status === "declined")) return { ok: true, status: json.status };
  const e = json.error;
  return { ok: false, error: e === "mfa" || e === "expired" || e === "state" || e === "forbidden" ? e : "down" };
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

/** The messages of one conversation as the thread keeps them: a question and its answer make one exchange; a message the router answered with a plan carries its state. */
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
      out.push({ asked, heardByVoice: false, answer: plan ? "" : String(m.text).slice(0, 12_000), sources: (m.sources ?? []).slice(0, 8).map((s) => ({ label: String(s.label), href: null })), drafts: [], errorCode: null, failed: false, task: null, plan });
      asked = "";
    }
  }
  if (asked !== "") out.push({ asked, heardByVoice: false, answer: "", sources: [], drafts: [], errorCode: null, failed: false, task: null });
  return out;
}
