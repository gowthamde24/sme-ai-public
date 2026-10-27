"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import { taskScreens } from "@/lib/screens/flag";
import { answerIt, approveIt, capIt, excludeThem, moveIt, planIt, readReport, readTask, readTemplates, type Ctx } from "@/lib/tasks/source";
import { TASK_LANGS, templateOffered, type Done, type ListedPerson, type ReportOut, type TaskError, type TaskLang, type TaskOut } from "@/lib/tasks/types";

/**
 * "Ask Vijaya to do it", the moves (night 4, job DR part B). Who may do what (the API is the real gate, this is the first): Owner, Admin and Sales plan, answer the one question and leave people out; ONLY the Owner approves or changes the
 * spending cap (the API asks the second factor: `mfa`); Owner and Admin continue, pause, resume and cancel; everyone reads (the progress, the report). The flag first: with TASK_SCREENS off nothing is done (`not_available`). A rejected
 * session goes to sign-in. A refusal comes back as a closed word the screens have a sentence for (lib/tasks/source.ts `mapError`: changed, mfa, read_only, waiting_for_whatsapp, not_for_schools, nobody, state ...), never as free text.
 */
export type TaskResult = { ok: true; task: TaskOut } | { ok: false; error: TaskError };
export type TemplateChoice = { id: string; label: string; example: string; promotional: boolean };
export type TemplatesResult = { ok: true; templates: TemplateChoice[] } | { ok: false; error: TaskError };
export type ReportResult = { ok: true; report: ReportOut } | { ok: false; error: TaskError };

const PLANNERS = new Set(["owner", "admin", "sales"]);
const MOVERS = new Set(["owner", "admin"]);

type Who = { ctx: Ctx; role: string };
async function who(tenantId: string, allowed: ReadonlySet<string> | null): Promise<Who | TaskError> {
  if (taskScreens() === "off") return "not_available";
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId)) return "not_found";
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    if (allowed !== null && !allowed.has(tenant.role)) return "forbidden";
    return { ctx: { token: user.accessToken, tenantId }, role: tenant.role };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return "not_found";
  }
}

function result(done: Done<TaskOut>, tenantId: string): TaskResult {
  if (!done.ok) return { ok: false, error: done.error };
  revalidatePath(`/app/tenants/${tenantId}/tasks`);
  revalidatePath(`/app/tenants/${tenantId}/tasks/${done.value.id}`);
  return { ok: true, task: done.value };
}

/** The owner's instruction becomes a plan (or ONE question). `taskId` is made by the browser: the same id again is a replay, so a double press makes one task. */
export async function planTaskAction(tenantId: string, taskId: string, instruction: string, language: TaskLang | null = null, contacts: ListedPerson[] = []): Promise<TaskResult> {
  const got = await who(tenantId, PLANNERS);
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof instruction !== "string" || typeof taskId !== "string" || (language !== null && !(TASK_LANGS as readonly string[]).includes(language)) || !Array.isArray(contacts) || contacts.some((c) => typeof c !== "object" || c === null)) return { ok: false, error: "invalid" };
  return result(await planIt(got.ctx, { taskId, instruction, language, ...(contacts.length > 0 ? { contacts } : {}) }), tenantId);
}

export async function answerTaskAction(tenantId: string, taskId: string, answer: string): Promise<TaskResult> {
  const got = await who(tenantId, PLANNERS);
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof answer !== "string" || typeof taskId !== "string") return { ok: false, error: "invalid" };
  return result(await answerIt(got.ctx, taskId, answer), tenantId);
}

export async function excludeContactsAction(tenantId: string, taskId: string, contactIds: string[], excluded: boolean): Promise<TaskResult> {
  const got = await who(tenantId, PLANNERS);
  if (typeof got === "string") return { ok: false, error: got };
  if (!Array.isArray(contactIds) || typeof excluded !== "boolean" || typeof taskId !== "string") return { ok: false, error: "invalid" };
  return result(await excludeThem(got.ctx, taskId, contactIds, excluded), tenantId);
}

/** One approval for everyone who is not left out. Owner only; the API asks for the second factor. `planSha256` is the hash the person saw: a plan that changed since answers `changed`. */
export async function approveTaskAction(tenantId: string, taskId: string, planSha256: string, capPaise: number | null = null): Promise<TaskResult> {
  const got = await who(tenantId, new Set(["owner"]));
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof planSha256 !== "string" || typeof taskId !== "string" || (capPaise !== null && typeof capPaise !== "number")) return { ok: false, error: "invalid" };
  return result(await approveIt(got.ctx, taskId, planSha256, capPaise), tenantId);
}

/** Raise (or lower) the spending cap of a task. Owner only, second factor. */
export async function setCapAction(tenantId: string, taskId: string, capPaise: number): Promise<TaskResult> {
  const got = await who(tenantId, new Set(["owner"]));
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof capPaise !== "number" || typeof taskId !== "string") return { ok: false, error: "invalid" };
  return result(await capIt(got.ctx, taskId, capPaise), tenantId);
}

async function move(tenantId: string, taskId: string, verb: "run" | "pause" | "resume" | "cancel"): Promise<TaskResult> {
  const got = await who(tenantId, MOVERS);
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof taskId !== "string") return { ok: false, error: "invalid" };
  return result(await moveIt(got.ctx, taskId, verb), tenantId);
}
export async function runTaskAction(tenantId: string, taskId: string): Promise<TaskResult> {
  return move(tenantId, taskId, "run");
}
export async function pauseTaskAction(tenantId: string, taskId: string): Promise<TaskResult> {
  return move(tenantId, taskId, "pause");
}
export async function resumeTaskAction(tenantId: string, taskId: string): Promise<TaskResult> {
  return move(tenantId, taskId, "resume");
}
export async function cancelTaskAction(tenantId: string, taskId: string): Promise<TaskResult> {
  return move(tenantId, taskId, "cancel");
}

/** The live progress, read by the page every few seconds while a task runs (a read: every member, a Viewer too; nothing is revalidated). */
export async function progressTaskAction(tenantId: string, taskId: string): Promise<TaskResult> {
  const got = await who(tenantId, null);
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof taskId !== "string") return { ok: false, error: "invalid" };
  const done = await readTask(got.ctx, taskId);
  return done.ok ? { ok: true, task: done.value } : { ok: false, error: done.error };
}

/** The report (the short answer first), for the thread of the Ask box when a task is over. A read. */
export async function reportTaskAction(tenantId: string, taskId: string): Promise<ReportResult> {
  const got = await who(tenantId, null);
  if (typeof got === "string") return { ok: false, error: got };
  if (typeof taskId !== "string") return { ok: false, error: "invalid" };
  const done = await readReport(got.ctx, taskId);
  return done.ok ? { ok: true, report: done.value } : { ok: false, error: done.error };
}

/** The ready-made tasks this workspace is offered (the ones for its business type: a school has no payment reminder), for the chips of the Ask box. A read: every member. */
export async function templatesTaskAction(tenantId: string): Promise<TemplatesResult> {
  const got = await who(tenantId, null);
  if (typeof got === "string") return { ok: false, error: got };
  const done = await readTemplates(got.ctx);
  if (!done.ok) return { ok: false, error: done.error };
  const pack = await readPackCached(got.ctx.token, tenantId).catch(() => null);
  return { ok: true, templates: done.value.templates.filter((x) => templateOffered(x, pack?.packId ?? null)).map((x) => ({ id: x.id, label: x.label, example: x.example_instruction, promotional: x.promotional })) };
}
