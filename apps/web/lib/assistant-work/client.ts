import { fileKindOf, parseActivityEntry, parsePlan, parseTestResult, parseUploadedFile, type ActivityEntry, type LiveTest, type TestResult, type UploadedFile, type WorkPlan } from "./types";
import { ACTIVITY_JSON, IMPORT_PLAN_JSON } from "./fixtures";

/**
 * The browser's side calls of the assistant's work cards. Two transports with ONE shape:
 *   routeTransport(base): this workspace's own route `<base>/assistant-work` (JSON, one op each) and `<base>/assistant-work/upload` (the file as the body), which hold the person's token and call the API
 *     (ASSUMED until docs/contracts/assistant-tools.md; see lib/assistant-work/types.ts for the assumed API routes);
 *   fixtureTransport(): made-up answers in the browser, no network at all (the tests, the preview page and ASSISTANT_WORK_SCREENS=mock: nothing is uploaded anywhere).
 * Every answer is a closed word on failure; the API's own English is never shown.
 */
export type PlanOutcome = { ok: true; plan: WorkPlan } | { ok: false; error: "mfa" | "forbidden" | "expired" | "state" | "down" };
export type UploadOutcome = { ok: true; file: UploadedFile } | { ok: false; error: "size" | "type" | "forbidden" | "down" | "aborted" };
export type SecretOutcome = { ok: true; last4: string | null } | { ok: false; error: "rejected" | "forbidden" | "down" };
export type TestOutcome = { ok: true; result: TestResult } | { ok: false; error: "forbidden" | "down" };
export type UndoOutcome = { ok: true; entry: ActivityEntry } | { ok: false; error: "expired" | "forbidden" | "down" };

export type WorkTransport = {
  upload(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadOutcome>;
  decide(planId: string, decision: "do" | "cancel", confirmed: boolean): Promise<PlanOutcome>;
  undo(planId: string): Promise<PlanOutcome>;
  /** The value is passed straight through to the request body and dropped: never kept, never logged. */
  saveSecret(requestId: string, value: string): Promise<SecretOutcome>;
  liveTest(setupId: string, test: LiveTest): Promise<TestOutcome>;
  undoAction(actionId: string): Promise<UndoOutcome>;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const PLAN_ERRORS = ["mfa", "forbidden", "expired", "state"] as const;

async function op(base: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetcher(`${base}/assistant-work`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isRec(json) ? json : null;
  } catch {
    return null;
  }
}

const planOutcome = (json: Record<string, unknown> | null): PlanOutcome => {
  if (json?.ok === true) {
    const plan = parsePlan(json.plan);
    if (plan) return { ok: true, plan };
  }
  const e = json?.error;
  return { ok: false, error: (PLAN_ERRORS as readonly unknown[]).includes(e) ? (e as (typeof PLAN_ERRORS)[number]) : "down" };
};

/** The upload, with its progress: XMLHttpRequest because fetch cannot report how much of a body has gone. */
function xhrUpload(url: string, file: File, onProgress: (f: number) => void, signal: AbortSignal): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = null;
      }
      const file = isRec(json) && json.ok === true ? parseUploadedFile(json.file) : null;
      if (file) return resolve({ ok: true, file });
      const e = isRec(json) ? json.error : null;
      resolve({ ok: false, error: e === "size" || e === "type" || e === "forbidden" ? e : "down" });
    };
    xhr.onerror = () => resolve({ ok: false, error: "down" });
    xhr.onabort = () => resolve({ ok: false, error: "aborted" });
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export function routeTransport(base: string, fetcher: typeof fetch = (...a) => fetch(...a)): WorkTransport {
  return {
    upload: (file, onProgress, signal) => xhrUpload(`${base}/assistant-work/upload?${new URLSearchParams({ name: file.name.slice(0, 200) }).toString()}`, file, onProgress, signal),
    decide: async (planId, decision, confirmed) => planOutcome(await op(base, { op: "decide", planId, decision, confirmed }, fetcher)),
    undo: async (planId) => planOutcome(await op(base, { op: "undo", planId }, fetcher)),
    saveSecret: async (requestId, value) => {
      const json = await op(base, { op: "secret", requestId, value }, fetcher);
      if (json?.ok === true) return { ok: true, last4: typeof json.last4 === "string" && /^[\w-]{4}$/.test(json.last4) ? json.last4 : null };
      return { ok: false, error: json?.error === "rejected" || json?.error === "forbidden" ? json.error : "down" };
    },
    liveTest: async (setupId, test) => {
      const json = await op(base, { op: "test", setupId, test }, fetcher);
      const result = json?.ok === true ? parseTestResult(json.result) : null;
      return result ? { ok: true, result } : { ok: false, error: json?.error === "forbidden" ? "forbidden" : "down" };
    },
    undoAction: async (actionId) => {
      const json = await op(base, { op: "undo_action", actionId }, fetcher);
      const entry = json?.ok === true ? parseActivityEntry(json.entry) : null;
      return entry ? { ok: true, entry } : { ok: false, error: json?.error === "expired" || json?.error === "forbidden" ? json.error : "down" };
    },
  };
}

export type FixtureOptions = {
  /** ms between progress ticks and before an answer (0 in tests). */
  delay?: number;
  /** Tools whose step fails when the plan runs (to show an honest failure). */
  failTools?: readonly string[];
  /** A live test of this setup fails with this reason. */
  failTests?: Readonly<Record<string, "key_rejected" | "nothing_arrived" | "timeout">>;
  /** Uploads fail (the network is down). */
  uploadDown?: boolean;
};

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const fixedId = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Made-up answers, in the browser only: nothing leaves the page. The plans it knows are kept here so Do it / Undo move them through their states. */
export function fixtureTransport(options: FixtureOptions = {}, plans: readonly unknown[] = [IMPORT_PLAN_JSON]): WorkTransport {
  const delay = options.delay ?? 250;
  const known = new Map<string, WorkPlan>();
  for (const p of plans) {
    const plan = parsePlan(p);
    if (plan) known.set(plan.planId, plan);
  }
  const entries = new Map<string, ActivityEntry>();
  for (const x of ACTIVITY_JSON.items) {
    const e = parseActivityEntry(x);
    if (e) entries.set(e.actionId, e);
  }
  let uploads = 0;
  return {
    async upload(file, onProgress, signal) {
      for (const f of [0.25, 0.5, 0.75, 1]) {
        if (signal.aborted) return { ok: false, error: "aborted" };
        await wait(delay);
        if (options.uploadDown && f >= 0.5) return { ok: false, error: "down" };
        onProgress(f);
      }
      if (signal.aborted) return { ok: false, error: "aborted" };
      const parsed = parseUploadedFile({ file_id: fixedId(++uploads), name: file.name, size_bytes: file.size, kind: fileKindOf(file.name) ?? "text", expires_at: null });
      return parsed ? { ok: true, file: parsed } : { ok: false, error: "type" };
    },
    async decide(planId, decision, confirmed) {
      await wait(delay);
      const plan = known.get(planId);
      if (!plan) return { ok: false, error: "down" };
      if (plan.status !== "proposed") return { ok: false, error: "state" };
      if (decision === "cancel") return remember({ ...plan, status: "cancelled" });
      if (plan.sensitive !== null && !confirmed) return { ok: false, error: "state" };
      const steps = plan.steps.map((s) => (options.failTools?.includes(s.tool) ? { ...s, status: "failed" as const, error: "invalid" as const } : { ...s, status: "done" as const, error: null }));
      const failed = steps.filter((s) => s.status === "failed").length;
      return remember({ ...plan, steps, status: failed === 0 ? "done" : failed === steps.length ? "failed" : "partly_done" });
    },
    async undo(planId) {
      await wait(delay);
      const plan = known.get(planId);
      if (!plan || (plan.status !== "done" && plan.status !== "partly_done")) return { ok: false, error: "state" };
      return remember({ ...plan, steps: plan.steps.map((s) => (s.status === "done" && s.undoable ? { ...s, status: "undone" } : s)), status: "undone" });
    },
    async saveSecret(_requestId, value) {
      await wait(delay);
      const v = value.trim();
      return v.length < 8 ? { ok: false, error: "rejected" } : { ok: true, last4: v.slice(-4).replace(/[^\w-]/g, "x") };
    },
    async liveTest(setupId) {
      await wait(delay);
      const reason = options.failTests?.[setupId];
      return { ok: true, result: reason ? { ok: false, reason, detail: null, at: new Date().toISOString() } : { ok: true, reason: null, detail: null, at: new Date().toISOString() } };
    },
    async undoAction(actionId) {
      await wait(delay);
      const e = entries.get(actionId);
      if (!e || e.undo !== "available") return { ok: false, error: "expired" };
      const next: ActivityEntry = { ...e, status: "undone", undo: "done" };
      entries.set(actionId, next);
      return { ok: true, entry: next };
    },
  };
  function remember(plan: WorkPlan): PlanOutcome {
    known.set(plan.planId, plan);
    return { ok: true, plan };
  }
}

