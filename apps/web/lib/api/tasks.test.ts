import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./client", async (orig) => ({ ...(await orig<typeof import("./client")>()), apiRequest: (...a: unknown[]) => h.request(...a) }));

import { ApiContractError } from "./client";
import { answerTask, approveTask, excludeTaskContacts, getTask, getTaskContacts, getTaskReport, getTaskTemplates, listTasks, moveTask, parseReport, parseTask, parseTaskContacts, parseTaskList, parseTemplates, planTask, setTaskCap } from "./tasks";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const CID = "44444444-4444-4444-8444-444444444444";

const PLAN = {
  channel: "call",
  goal: "Ask each supplier today's price.",
  questions: [{ key: "price_per_bag", text: "Price per bag?", type: "amount" }],
  script_notes: "",
  message_text: null,
  window: { date: "2026-10-28", from_minute: 600, to_minute: 1140 },
  follow_up: { kind: "none", after_hours: 24 },
  contacts_total: 12,
  contacts_sample: [{ contact_id: CID, name: "Sri Venkateswara Traders" }],
  unmatched: [{ name: null, phone_last4: "3210" }],
  notes: ["capped at 500"],
};
const TASK = {
  id: ID,
  status: "planned",
  instruction: "Call my suppliers",
  language: "te",
  template: "supplier_price_enquiry",
  question: null,
  plan: PLAN,
  estimate: { contacts: 12, calls: 12, messages: 12, minutes: 24, cost_paise: 3600, basis: "fake rates" },
  cap_paise: 4320,
  spent_paise: 0,
  pause_reason: null,
  progress: { total: 12, excluded: 0, waiting: 12, in_progress: 0, done: 0, failed: 0, skipped: 0, reached: 0, positive: 0 },
  plan_sha256: "ab".repeat(32),
  simulated: true,
  wording: "draft",
  created_at: "2026-10-28T05:00:00Z",
  approved_at: null,
  finished_at: null,
};

beforeEach(() => h.request.mockReset());

describe("the tasks API readers", () => {
  it("read a task exactly as the contract shapes it", () => {
    const t = parseTask(TASK);
    expect(t).toMatchObject({ id: ID, status: "planned", language: "te", template: "supplier_price_enquiry", cap_paise: 4320, simulated: true, wording: "draft" });
    expect(t.plan?.contacts_sample[0].name).toBe("Sri Venkateswara Traders");
    expect(t.plan?.unmatched[0].phone_last4).toBe("3210");
    expect(t.estimate?.cost_paise).toBe(3600);
  });
  it("read a task that asks its one question, and a plan with the optional lists left out", () => {
    const q = parseTask({ ...TASK, status: "needs_answer", plan: null, estimate: null, cap_paise: null, plan_sha256: null, question: "Who should be called?" });
    expect(q).toMatchObject({ status: "needs_answer", plan: null, question: "Who should be called?" });
    const lean = parseTask({ ...TASK, plan: { ...PLAN, contacts_sample: undefined, unmatched: undefined, notes: undefined, questions: undefined } });
    expect(lean.plan).toMatchObject({ contacts_sample: [], unmatched: [], notes: [], questions: [] });
  });
  it.each([
    ["an unknown status", { ...TASK, status: "flying" }],
    ["an unknown template", { ...TASK, template: "sell_everything" }],
    ["a language the product does not have", { ...TASK, language: "fr" }],
    ["a money amount that is not whole paise", { ...TASK, spent_paise: 1.5 }],
    ["a negative cap", { ...TASK, cap_paise: -1 }],
    ["an id that is not a uuid", { ...TASK, id: "x" }],
    ["a progress count that is a string", { ...TASK, progress: { ...TASK.progress, done: "3" } }],
    ["a window date that is not a date", { ...TASK, plan: { ...PLAN, window: { ...PLAN.window, date: "tomorrow" } } }],
    ["a pause reason it does not know", { ...TASK, pause_reason: "weather" }],
    ["a hash that is not hex", { ...TASK, plan_sha256: "not hex!" }],
    ["wording that is not draft", { ...TASK, wording: "final" }],
    ["simulated false", { ...TASK, simulated: false }],
    ["a sample contact without an id", { ...TASK, plan: { ...PLAN, contacts_sample: [{ name: "x" }] } }],
  ])("refuse %s", (_name, body) => {
    expect(() => parseTask(body)).toThrow(ApiContractError);
  });
  it("read the list (a plain array), and refuse an object", () => {
    expect(parseTaskList([TASK, { ...TASK, id: CID }])).toHaveLength(2);
    expect(() => parseTaskList({ tasks: [] })).toThrow(ApiContractError);
  });
  it("read the people of a task and keep captured values plain", () => {
    const body = { contacts: [{ id: CID, contact_id: ID, name: "Ravi", phone_last4: "3210", status: "done", skip_reason: null, outcome: "positive", outcome_category: "interested", captured: { price_per_bag: 39500, delivery_day: "Thursday" }, simulated: true }], next_cursor: null };
    expect(parseTaskContacts(body).contacts[0].captured).toEqual({ price_per_bag: 39500, delivery_day: "Thursday" });
    expect(() => parseTaskContacts({ ...body, contacts: [{ ...body.contacts[0], captured: { x: { nested: 1 } } }] })).toThrow(ApiContractError);
    expect(() => parseTaskContacts({ ...body, contacts: [{ ...body.contacts[0], status: "gone" }] })).toThrow(ApiContractError);
    expect(() => parseTaskContacts({ ...body, contacts: [{ ...body.contacts[0], captured: { "<b>": 1 } }] })).toThrow(ApiContractError);
  });
  const ROW = { contact_id: CID, name: "Ravi", phone_last4: "3210", outcome: "positive", category: "interested", captured: { price_per_bag: 39500 }, transcript: [{ who: "assistant", text: "Hello" }, { who: "contact", text: "395" }], recording_url: "https://x.example/rec.mp3", simulated: true, message_status: "queued" };
  const REPORT = { task_id: ID, status: "done", short_answer: "Cheapest: A ₹395/bag, delivery Thursday", short_answer_kind: "cheapest", totals: { contacts: 12, reached: 9, positive: 4, negative: 3, unclear: 2, no_answer: 3, spent_paise: 3120 }, rows: [ROW], simulated: true, wording: "draft" };
  it("read a report, and never keep a recording link (there is no telephony yet)", () => {
    const r = parseReport(REPORT);
    expect(r.short_answer).toContain("Cheapest");
    expect(r.rows[0].recording_url).toBeNull();
    expect(r.rows[0].transcript).toHaveLength(2);
    expect(parseReport({ ...REPORT, rows: [{ ...ROW, transcript: null, captured: null, message_status: null, category: null }] }).rows[0].transcript).toBeNull();
  });
  it.each([
    ["a transcript speaker it does not know", { ...REPORT, rows: [{ ...ROW, transcript: [{ who: "robot", text: "x" }] }] }],
    ["a short answer kind it does not know", { ...REPORT, short_answer_kind: "poem" }],
    ["totals missing a count", { ...REPORT, totals: { contacts: 1 } }],
    ["an outcome with markup", { ...REPORT, rows: [{ ...ROW, outcome: "<script>" }] }],
  ])("refuse a report with %s", (_n, body) => {
    expect(() => parseReport(body)).toThrow(ApiContractError);
  });
  it("read the templates, and refuse a custom one", () => {
    const t = { id: "payment_reminder", label: "Payment reminder", channel_default: "both", needs_pack: "not education", promotional: false, example_instruction: "Remind them" };
    expect(parseTemplates({ templates: [t] }).templates[0]).toMatchObject({ id: "payment_reminder", needs_pack: "not education" });
    expect(() => parseTemplates({ templates: [{ ...t, id: "custom" }] })).toThrow(ApiContractError);
  });
});

describe("the tasks API calls", () => {
  it("send the plan with a client-made id and only what was given", async () => {
    h.request.mockResolvedValueOnce(TASK);
    await planTask("tok", T, { taskId: ID, instruction: "Call my suppliers", language: "te" });
    expect(h.request).toHaveBeenCalledWith(`/v1/tenants/${T}/tasks/plan`, "tok", { method: "POST", body: JSON.stringify({ instruction: "Call my suppliers", task_id: ID, language: "te" }) });
  });
  it("use the paths and verbs of the contract", async () => {
    h.request.mockResolvedValue(TASK);
    await answerTask("t", T, ID, "my suppliers");
    await approveTask("t", T, ID, "ab".repeat(32), 5000);
    await approveTask("t", T, ID, "ab".repeat(32));
    await setTaskCap("t", T, ID, 9000);
    await excludeTaskContacts("t", T, ID, [CID], true);
    for (const verb of ["run", "pause", "resume", "cancel"] as const) await moveTask("t", T, ID, verb);
    await getTask("t", T, ID);
    const calls = h.request.mock.calls.map((c) => `${(c[2] as RequestInit | undefined)?.method ?? "GET"} ${String(c[0]).replace(`/v1/tenants/${T}/tasks`, "")}`);
    expect(calls).toEqual([`POST /${ID}/answer`, `POST /${ID}/approve`, `POST /${ID}/approve`, `POST /${ID}/cap`, `POST /${ID}/contacts/exclude`, `POST /${ID}/run`, `POST /${ID}/pause`, `POST /${ID}/resume`, `POST /${ID}/cancel`, `GET /${ID}`]);
    expect(JSON.parse((h.request.mock.calls[1][2] as RequestInit).body as string)).toEqual({ plan_sha256: "ab".repeat(32), cap_paise: 5000 });
    expect(JSON.parse((h.request.mock.calls[2][2] as RequestInit).body as string)).toEqual({ plan_sha256: "ab".repeat(32) });
    expect(JSON.parse((h.request.mock.calls[4][2] as RequestInit).body as string)).toEqual({ contact_ids: [CID], excluded: true });
  });
  it("ask for lists with a bounded query, and read the report and the templates", async () => {
    h.request.mockResolvedValueOnce([]);
    await listTasks("t", T, { status: "running", limit: 500, before: "2026-10-28T05:00:00Z" });
    expect(h.request.mock.calls[0][0]).toBe(`/v1/tenants/${T}/tasks?status=running&limit=100&before=2026-10-28T05%3A00%3A00Z`);
    h.request.mockResolvedValueOnce({ contacts: [], next_cursor: null });
    await getTaskContacts("t", T, ID, { status: "done", limit: 50, cursor: "12; drop" });
    expect(h.request.mock.calls[1][0]).toBe(`/v1/tenants/${T}/tasks/${ID}/contacts?status=done&limit=50`);
    h.request.mockResolvedValueOnce({ templates: [] });
    expect(await getTaskTemplates("t", T)).toEqual({ templates: [] });
    h.request.mockResolvedValueOnce({ task_id: ID, status: "done", short_answer: "x", short_answer_kind: "counts", totals: { contacts: 0, reached: 0, positive: 0, negative: 0, unclear: 0, no_answer: 0, spent_paise: 0 }, rows: [] });
    expect((await getTaskReport("t", T, ID)).rows).toEqual([]);
  });
  it("refuse an id that is not a uuid before asking anything", async () => {
    await expect(getTask("t", T, "../x")).rejects.toThrow(ApiContractError);
    await expect(getTask("t", "nope", ID)).rejects.toThrow(ApiContractError);
    await expect(excludeTaskContacts("t", T, ID, ["x"], true)).rejects.toThrow(ApiContractError);
    expect(h.request).not.toHaveBeenCalled();
  });
  it("never draws an answer that is not the contract", async () => {
    h.request.mockResolvedValueOnce({ id: ID });
    await expect(getTask("t", T, ID)).rejects.toThrow(ApiContractError);
  });
});
