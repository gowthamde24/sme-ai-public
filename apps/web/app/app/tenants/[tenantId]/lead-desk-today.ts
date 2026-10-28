import type { DeskWorker, NeedsCard, NeedsYouItem, Role, T } from "@/components/v2/app/today/types";
import { ApiAuthError } from "@/lib/api/client";
import { readDeskLeads } from "@/lib/lead-desk/leads-source";
import { readBatches, readHandoffs, readItems, readRules } from "@/lib/outreach/source";
import { SOURCE_TAGS, type BatchAnswer, type BatchItem, type Handoff, type Rule } from "@/lib/outreach/types";
import { leadsScreens, outreachScreens, taskScreens } from "@/lib/screens/flag";
import { readTasks } from "@/lib/tasks/source";
import type { TaskOut } from "@/lib/tasks/types";

/**
 * What Lead Desk adds to Today (night 5): the things that wait for a person in a workspace that catches leads and calls them, and the workers that do it, each from the real state of its own part. Nothing here is a guess: a part that is
 * switched off is left out, a part that cannot be read says so (or adds nothing), and a rejected session still sends the person to sign in (ApiAuthError is rethrown).
 *
 * "Needs you" gets four kinds: a HOT lead (an open hand-off: somebody showed interest and nobody has called back), a PLAN waiting for the Owner's one approval (a calling plan, or a task of "Ask {assistant} to do it"), CALLBACKS that are due (people
 * who asked to be called back, whose time has come), and calling PAUSED because a limit was reached (a plan, a standing rule or a task). Who sees what follows who may act: the Owner decides plans, the Owner and Admin see limits and callbacks, and the Owner, Admin
 * and Sales see hot leads (the API gives a Sales member only theirs). A card is keyed like the API's own item of the same kind (`kind-id`), so a hot lead or a pause the API listed too is one card, not two. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string; userId: string };
export type LeadDeskToday = { needs: NeedsCard[]; team: DeskWorker[] };

const settled = <V>(r: PromiseSettledResult<V>): V | null => {
  if (r.status === "fulfilled") return r.value;
  if (r.reason instanceof ApiAuthError) throw r.reason;
  return null;
};

/**
 * The plain name of a lead source for a line of Today. Only the tags Lead Desk knows (`SOURCE_TAGS`) have a word in the dictionary; any other source a CRM lead may carry (a WhatsApp enquiry, something typed by hand, a tag
 * from before Lead Desk) is shown as it is, with the underscores taken out. Never a dictionary lookup that can miss: a missing key made Today fail for every business type with its own pages.
 */
export const sourceNameOf = (t: T, tag: string): string => ((SOURCE_TAGS as readonly string[]).includes(tag) ? t(`ld.source.${tag}`) : tag.replace(/_/g, " "));

const CAPS = ["cap_calls", "cap_minutes"] as const;
const isCap = (reason: string | null): boolean => reason !== null && (CAPS as readonly string[]).includes(reason);
const short = (text: string, max = 80): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

type Made = Omit<NeedsYouItem, "agent" | "city" | "amount_paise" | "summary"> & { summary: string };
const card = (m: Made): NeedsCard => ({ type: "item", key: `${m.kind}-${m.id}`, at: m.at, item: { ...m, city: null, agent: "followup_desk", amount_paise: null } });

/** The calls a batch still owes people who asked for a call back: an item that was answered, is waiting for a call and whose time has come (oldest first). */
const dueItems = (items: readonly BatchItem[], now: number): BatchItem[] =>
  items.filter((i) => i.status === "waiting" && i.nextAction === "call" && i.attempts >= 1 && i.lastResult === "connected" && i.nextAt !== null && Date.parse(i.nextAt) <= now).sort((a, b) => Date.parse(a.nextAt ?? "") - Date.parse(b.nextAt ?? ""));

type Parts = { batches: BatchAnswer[] | null; handoffs: Handoff[] | null; rules: Rule[] | null; tasks: TaskOut[] | null; callbacks: Map<string, { name: string; n: number; at: string }> };

export function needsOf(parts: Parts, role: Role, base: string, t: T, sourceName: (tag: string) => string): NeedsCard[] {
  const out: NeedsCard[] = [];
  const decides = role === "owner";
  const manages = role === "owner" || role === "admin";
  if (parts.handoffs) {
    for (const h of parts.handoffs) {
      if (h.actedAt !== null) continue;
      out.push(card({ kind: "hot_lead_waiting", id: h.id, customer: h.contactName, summary: t("today.sum.hot"), at: h.notifiedAt, href: h.leadId ? `${base}/leads/${h.leadId}` : `${base}/lead-desk?hot=1` }));
    }
  }
  if (decides) {
    for (const b of parts.batches ?? []) {
      if (b.batch.status !== "planned") continue;
      out.push(card({ kind: "plan_waiting", id: b.batch.id, customer: b.batch.name, summary: t("today.sum.plan", { n: b.plan.ready }), at: b.batch.createdAt, href: `${base}/outreach/batches/${b.batch.id}` }));
    }
    for (const k of parts.tasks ?? []) {
      if (k.status !== "planned") continue;
      out.push(card({ kind: "plan_waiting", id: k.id, customer: short(k.instruction), summary: t("today.sum.plan.task"), at: k.created_at, href: `${base}/tasks/${k.id}` }));
    }
  }
  if (manages) {
    for (const b of parts.batches ?? []) {
      if (b.batch.status !== "paused" || !isCap(b.batch.pausedReason)) continue;
      out.push(card({ kind: "outreach_paused", id: b.batch.id, customer: b.batch.name, summary: t(b.batch.pausedReason === "cap_minutes" ? "today.sum.cap.minutes" : "today.sum.cap.calls"), at: b.batch.approvedAt ?? b.batch.createdAt, href: `${base}/outreach/batches/${b.batch.id}` }));
    }
    for (const r of parts.rules ?? []) {
      if (r.active || !isCap(r.pausedReason)) continue;
      out.push(card({ kind: "outreach_paused", id: r.id, customer: sourceName(r.source), summary: t(r.pausedReason === "cap_minutes" ? "today.sum.cap.minutes" : "today.sum.cap.calls"), at: r.approvedAt, href: `${base}/outreach` }));
    }
    for (const k of parts.tasks ?? []) {
      if (k.status !== "paused" || k.pause_reason !== "cap") continue;
      out.push(card({ kind: "outreach_paused", id: k.id, customer: short(k.instruction), summary: t("today.sum.cap.task"), at: k.approved_at ?? k.created_at, href: `${base}/tasks/${k.id}` }));
    }
    for (const [batchId, c] of parts.callbacks) {
      out.push(card({ kind: "callback_due", id: batchId, customer: c.name, summary: t("today.sum.callback", { n: c.n }), at: c.at, href: `${base}/outreach/batches/${batchId}` }));
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** One line for a worker: what it is doing now, or the last thing it did (the screen adds how long ago). */
export function teamOf(parts: Parts & { lead: { name: string; source: string | null; at: string } | null | undefined }, t: T, sourceName: (tag: string) => string): DeskWorker[] {
  const team: DeskWorker[] = [];
  if (parts.lead !== undefined) {
    team.push({ key: "leads", name: t("dw.leads"), state: "idle", text: parts.lead ? t(parts.lead.source ? "dw.leads.last" : "dw.leads.last.nosource", { name: parts.lead.name, source: parts.lead.source ? sourceName(parts.lead.source) : "" }) : t("dw.leads.none"), at: parts.lead?.at ?? null });
  }
  if (parts.batches) {
    const running = parts.batches.filter((b) => b.batch.status === "running");
    const latest = [...parts.batches].filter((b) => b.batch.approvedAt !== null).sort((a, b) => Date.parse(b.batch.approvedAt ?? "") - Date.parse(a.batch.approvedAt ?? ""))[0];
    const first = running[0];
    team.push({
      key: "calls",
      name: t("dw.calls"),
      state: first ? "working" : "idle",
      text: first ? t("dw.calls.running", { name: first.batch.name, done: first.progress?.done ?? 0, total: first.progress?.total ?? first.plan.count }) : latest ? t("dw.calls.last", { name: latest.batch.name }) : t("dw.calls.none"),
      at: first ? (first.batch.approvedAt ?? null) : (latest?.batch.approvedAt ?? null),
    });
  }
  if (parts.rules) {
    const on = parts.rules.filter((r) => r.active).length;
    team.push({ key: "rules", name: t("dw.rules"), state: on > 0 ? "idle" : "off", text: on > 0 ? t(on === 1 ? "dw.rules.one" : "dw.rules.other", { n: on }) : t("dw.rules.none"), at: null });
  }
  if (parts.tasks) {
    const running = parts.tasks.find((k) => k.status === "running");
    const last = parts.tasks.find((k) => k.status === "done");
    team.push({ key: "tasks", name: t("dw.tasks"), state: running ? "working" : "idle", text: running ? t("dw.tasks.running", { name: short(running.instruction, 50) }) : last ? t("dw.tasks.last", { name: short(last.instruction, 50) }) : t("dw.tasks.none"), at: running ? (running.approved_at ?? null) : (last?.finished_at ?? null) });
  }
  return team;
}

/**
 * Reads what Lead Desk adds to Today. `withTeam` is false for a business type that has no Lead Desk template: its Today gets the cards but its "Your team" is the shop's helpers, so the leads are not even read. Each part is read once, on its own (a part whose flag is off is not asked), and one that fails adds nothing and is `not_available` in the team. `sourceName` is the plain name of a lead source ("IndiaMART").
 * Callbacks are counted from the items of the (at most five) running plans, the newest first: a plan with callbacks due is one card with the number. `base` is the workspace's address.
 */
export async function readLeadDesk(ctx: Ctx, role: Role, base: string, t: T, sourceName: (tag: string) => string, now: number = Date.now(), withTeam = true): Promise<LeadDeskToday> {
  if (role === "viewer") return { needs: [], team: [] };
  const manages = role === "owner" || role === "admin";
  const outreach = outreachScreens() !== "off";
  const [batches, handoffs, rules, tasks, leads] = await Promise.allSettled([
    outreach ? readBatches(ctx) : Promise.resolve(null),
    outreach ? readHandoffs(ctx, true) : Promise.resolve(null),
    outreach && manages ? readRules(ctx) : Promise.resolve(null),
    taskScreens() !== "off" && manages ? readTasks({ token: ctx.token, tenantId: ctx.tenantId }).then((r) => (r.ok ? r.value : null)) : Promise.resolve(null),
    withTeam && leadsScreens() !== "off" && manages ? readDeskLeads(ctx, null) : Promise.resolve(null),
  ]);
  const parts: Parts = { batches: settled(batches), handoffs: settled(handoffs), rules: settled(rules), tasks: settled(tasks), callbacks: new Map() };
  const lead = settled(leads);
  const callbacks = manages && parts.batches ? await readCallbacks(ctx, parts.batches, now) : new Map();
  parts.callbacks = callbacks;
  const newest = lead?.leads.length ? [...lead.leads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] : null;
  const team = manages && withTeam ? teamOf({ ...parts, lead: leadsScreens() === "off" ? undefined : lead === null ? undefined : newest ? { name: newest.name, source: newest.source, at: newest.createdAt } : null }, t, sourceName) : [];
  return { needs: needsOf(parts, role, base, t, sourceName), team };
}

async function readCallbacks(ctx: Ctx, batches: readonly BatchAnswer[], now: number): Promise<Map<string, { name: string; n: number; at: string }>> {
  const running = batches.filter((b) => b.batch.status === "running").slice(0, 5);
  const pages = await Promise.allSettled(running.map((b) => readItems(ctx, b.batch.id, null)));
  const found = new Map<string, { name: string; n: number; at: string }>();
  pages.forEach((p, i) => {
    const page = settled(p);
    const due = page ? dueItems(page.items, now) : [];
    if (due.length > 0) found.set(running[i].batch.id, { name: running[i].batch.name, n: due.length, at: due[0].nextAt as string });
  });
  return found;
}
