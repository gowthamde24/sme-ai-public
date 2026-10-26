import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { answerTask, approveTask, excludeTaskContacts, getTask, getTaskContacts, getTaskReport, getTaskTemplates, listTasks, moveTask, planTask, setTaskCap } from "@/lib/api/tasks";
import { readJar, writeJar } from "@/lib/mock/jar";
import { taskScreens } from "@/lib/screens/flag";

import { answerMockTask, approveMock, deriveContacts, deriveReport, deriveTask, indexOfContact, mockTemplates, MOCK_KEEP, moveMock, newMockTask, parseMockJar, planSha, settle, type MockTask } from "./mock";
import { ANSWER_MAX, INSTRUCTION_MAX, INSTRUCTION_MIN, LIST_MAX, TASK_LANGS, type Done, type ListedPerson, type ReportOut, type TaskContactsOut, type TaskError, type TaskLang, type TaskOut, type TaskStatus, type TemplatesOut } from "./types";

/**
 * Where the tasks come from and go (night 4, job DR part B). `mock` = the browser's ONE small cookie plus a deterministic fake (lib/tasks/mock.ts; nothing is sent), `on` = C1's API (lib/api/tasks.ts), `off` = the part is not there:
 * every function then answers `not_available` and the pages answer 404. Every function takes the signed-in person's token and the workspace; the ROLE check is the caller's (the server actions) and the API's. SERVER ONLY.
 */
export const MOCK_COOKIE = "sme_tasks_mock";
export type Ctx = { token: string; tenantId: string };

const fail = (error: TaskError): { ok: false; error: TaskError } => ({ ok: false, error });
const ok = <T>(value: T): Done<T> => ({ ok: true, value });

/** What the API's refusals mean to a person. A refusal not listed is "down" (try again): never a guess about the cause. */
export function mapError(error: unknown): TaskError {
  if (error instanceof ApiRequestError) {
    if (error.code === "plan_changed") return "changed";
    if (error.code === "mfa_required") return "mfa";
    if (error.code === "workspace_read_only") return "read_only";
    if (error.code === "waiting_for_whatsapp") return "waiting_for_whatsapp";
    if (error.code === "not_for_schools") return "not_for_schools";
    if (error.code === "invalid_value") return "nobody";
    if (error.code === "not_planned" || error.code === "task_state") return "state";
    if (error.status === 404) return "not_found";
    if (error.status === 403) return "forbidden";
    if (error.status === 422) return "invalid";
    if (error.status === 429 || error.code === "model_busy") return "busy";
  }
  return "down";
}

async function guarded<T>(run: () => Promise<T>): Promise<Done<T>> {
  try {
    return ok(await run());
  } catch (error) {
    if (error instanceof ApiAuthError) throw error; // the caller sends the person to sign in
    return fail(mapError(error));
  }
}

// ---- the mock's cookie ------------------------------------------------------------------------------------------------------
async function readMock(): Promise<MockTask[]> {
  return readJar<MockTask[]>(MOCK_COOKIE, parseMockJar, []);
}
async function saveMock(all: MockTask[]): Promise<boolean> {
  let keep = [...all].sort((a, b) => b.ca - a.ca).slice(0, MOCK_KEEP);
  for (;;) {
    if (await writeJar(MOCK_COOKIE, keep, 7)) return true;
    if (keep.length <= 1) return false;
    keep = keep.slice(0, -1);
  }
}
async function changeMock(id: string, change: (m: MockTask, now: number) => MockTask | TaskError): Promise<Done<TaskOut>> {
  if (!isCanonicalUuid(id)) return fail("not_found");
  const all = await readMock();
  const found = all.find((t) => t.id === id);
  if (!found) return fail("not_found");
  const now = Date.now();
  const next = change(settle(found, now), now);
  if (typeof next === "string") return fail(next);
  if (!(await saveMock(all.map((t) => (t.id === id ? next : t))))) return fail("down");
  return ok(deriveTask(next, now));
}

// ---- reads -------------------------------------------------------------------------------------------------------------------
export async function readTemplates(ctx: Ctx): Promise<Done<TemplatesOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (mode === "mock") return ok(mockTemplates());
  return guarded(() => getTaskTemplates(ctx.token, ctx.tenantId));
}

export async function readTasks(ctx: Ctx, status?: TaskStatus): Promise<Done<TaskOut[]>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (mode === "mock") {
    const now = Date.now();
    const all = (await readMock()).sort((a, b) => b.ca - a.ca).map((m) => deriveTask(m, now));
    return ok(status ? all.filter((t) => t.status === status) : all);
  }
  return guarded(() => listTasks(ctx.token, ctx.tenantId, { status, limit: 100 }));
}

export async function readTask(ctx: Ctx, id: string): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id)) return fail("not_found");
  if (mode === "mock") {
    const m = (await readMock()).find((t) => t.id === id);
    return m ? ok(deriveTask(m, Date.now())) : fail("not_found");
  }
  return guarded(() => getTask(ctx.token, ctx.tenantId, id));
}

export async function readContacts(ctx: Ctx, id: string, status?: string): Promise<Done<TaskContactsOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id)) return fail("not_found");
  if (mode === "mock") {
    const m = (await readMock()).find((t) => t.id === id);
    return m ? ok({ contacts: deriveContacts(m, Date.now(), status ?? null), next_cursor: null }) : fail("not_found");
  }
  return guarded(() => getTaskContacts(ctx.token, ctx.tenantId, id, { status, limit: 200 }));
}

export async function readReport(ctx: Ctx, id: string): Promise<Done<ReportOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id)) return fail("not_found");
  if (mode === "mock") {
    const m = (await readMock()).find((t) => t.id === id);
    const report = m ? deriveReport(m, Date.now()) : null;
    return report ? ok(report) : fail(m ? "state" : "not_found");
  }
  return guarded(() => getTaskReport(ctx.token, ctx.tenantId, id));
}

// ---- moves -------------------------------------------------------------------------------------------------------------------
const PHONE = /^\+?[0-9(][0-9 ()-]{5,18}[0-9]$/;

export async function planIt(ctx: Ctx, input: { taskId: string; instruction: string; language: TaskLang | null; contacts?: readonly ListedPerson[] }): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  const instruction = input.instruction.trim();
  if (instruction.length < INSTRUCTION_MIN || instruction.length > INSTRUCTION_MAX || !isCanonicalUuid(input.taskId) || (input.language !== null && !(TASK_LANGS as readonly string[]).includes(input.language))) return fail("invalid");
  const listed = input.contacts ?? [];
  if (listed.length > LIST_MAX || listed.some((c) => typeof c.phone !== "string" || !PHONE.test(c.phone.trim()) || (c.name != null && (typeof c.name !== "string" || c.name.length > 80)))) return fail("invalid");
  if (mode === "mock") {
    const all = await readMock();
    const now = Date.now();
    const same = all.find((t) => t.id === input.taskId);
    if (same) return ok(deriveTask(same, now)); // the same id again is a replay
    const made = newMockTask(input.taskId, instruction, input.language, now, listed.length > 0);
    return (await saveMock([...all, made])) ? ok(deriveTask(made, now)) : fail("down");
  }
  return guarded(() => planTask(ctx.token, ctx.tenantId, { taskId: input.taskId, instruction, language: input.language, contacts: listed.map((c) => ({ name: c.name ?? null, phone: c.phone.trim() })) }));
}

export async function answerIt(ctx: Ctx, id: string, answer: string): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  const text = answer.trim();
  if (text.length < 1 || text.length > ANSWER_MAX || !isCanonicalUuid(id)) return fail("invalid");
  if (mode === "mock") return changeMock(id, (m) => (m.st === "needs_answer" ? answerMockTask(m, text) : "state"));
  return guarded(() => answerTask(ctx.token, ctx.tenantId, id, text));
}

export async function excludeThem(ctx: Ctx, id: string, contactIds: readonly string[], excluded: boolean): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id) || contactIds.length === 0 || contactIds.length > 500 || contactIds.some((c) => !isCanonicalUuid(c))) return fail("invalid");
  if (mode === "mock") {
    return changeMock(id, (m) => {
      if (m.st !== "planned") return "state";
      const indexes = contactIds.map(indexOfContact);
      if (indexes.some((i) => i === null)) return "invalid";
      const set = new Set(m.ex);
      for (const i of indexes as number[]) {
        if (excluded) set.add(i);
        else set.delete(i);
      }
      return { ...m, ex: [...set].sort((a, b) => a - b) };
    });
  }
  return guarded(() => excludeTaskContacts(ctx.token, ctx.tenantId, id, contactIds, excluded));
}

export async function approveIt(ctx: Ctx, id: string, planSha256: string, capPaise: number | null): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id) || !/^[0-9a-f]{8,64}$/i.test(planSha256) || (capPaise !== null && (!Number.isSafeInteger(capPaise) || capPaise < 0 || capPaise > 1_000_000_000))) return fail("invalid");
  if (mode === "mock") {
    return changeMock(id, (m, now) => {
      if (m.st !== "planned") return "state";
      if (planSha(m) !== planSha256) return "changed";
      if (deriveTask(m, now).progress.total - m.ex.length <= 0) return "nobody";
      return approveMock(m, now, capPaise);
    });
  }
  return guarded(() => approveTask(ctx.token, ctx.tenantId, id, planSha256, capPaise));
}

export async function capIt(ctx: Ctx, id: string, capPaise: number): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id) || !Number.isSafeInteger(capPaise) || capPaise < 0 || capPaise > 1_000_000_000) return fail("invalid");
  if (mode === "mock") return changeMock(id, (m) => (m.st === "active" || m.st === "paused" || m.st === "planned" ? { ...m, cap: capPaise } : "state"));
  return guarded(() => setTaskCap(ctx.token, ctx.tenantId, id, capPaise));
}

export async function moveIt(ctx: Ctx, id: string, verb: "run" | "pause" | "resume" | "cancel"): Promise<Done<TaskOut>> {
  const mode = taskScreens();
  if (mode === "off") return fail("not_available");
  if (!isCanonicalUuid(id)) return fail("not_found");
  if (mode === "mock") return changeMock(id, (m, now) => moveMock(m, verb, now) ?? "state");
  return guarded(() => moveTask(ctx.token, ctx.tenantId, id, verb));
}
