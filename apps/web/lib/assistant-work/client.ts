import { parseActivityEntry, parsePlan, parseTestResult, parseUploadedFile, type ActivityEntry, type LiveTest, type TestResult, type UploadedFile, type WorkPlan } from "./types";

/**
 * The browser's side calls of the assistant's work cards. Two transports with ONE shape:
 *   routeTransport(base): this workspace's own route `<base>/assistant-work` (JSON, one op each) and `<base>/assistant-work/upload` (the file as the body), which hold the person's token and call the API
 *     (C1's contract, docs/contracts/assistant-tools.md; lib/api/assistant-work.ts has the API routes);
 *   fixtureTransport(): made-up answers in the browser, no network at all (the tests, the preview page and ASSISTANT_WORK_SCREENS=mock: nothing is uploaded anywhere).
 * Every answer is a closed word on failure; the API's own English is never shown.
 */
export type PlanOutcome = { ok: true; plan: WorkPlan } | { ok: false; error: "mfa" | "forbidden" | "expired" | "state" | "down" };
export type UploadOutcome = { ok: true; file: UploadedFile } | { ok: false; error: "size" | "type" | "empty" | "forbidden" | "down" | "aborted" };
export type SecretOutcome = { ok: true; last4: string | null } | { ok: false; error: "rejected" | "forbidden" | "renew" | "down" };
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
      resolve({ ok: false, error: e === "size" || e === "type" || e === "empty" || e === "forbidden" ? e : "down" });
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
      return { ok: false, error: json?.error === "rejected" || json?.error === "forbidden" || json?.error === "renew" ? json.error : "down" };
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

/**
 * Made-up answers, in the browser only: nothing leaves the page. The answers and their invented data (./fixture-transport.ts, ./fixtures.ts) are a chunk of their own, loaded the first time one is asked
 * for: a page that never uses the made-up answers (ASSISTANT_WORK_SCREENS off or on) does not carry them in its first load. `plans`: the plans it knows (default: the leads import's).
 */
export function fixtureTransport(options: FixtureOptions = {}, plans?: readonly unknown[]): WorkTransport {
  let real: Promise<WorkTransport> | null = null;
  const get = () => (real ??= import("./fixture-transport").then((m) => m.fixtureTransport(options, plans)));
  return {
    upload: async (file, onProgress, signal) => (await get()).upload(file, onProgress, signal),
    decide: async (planId, decision, confirmed) => (await get()).decide(planId, decision, confirmed),
    undo: async (planId) => (await get()).undo(planId),
    saveSecret: async (requestId, value) => (await get()).saveSecret(requestId, value),
    liveTest: async (setupId, test) => (await get()).liveTest(setupId, test),
    undoAction: async (actionId) => (await get()).undoAction(actionId),
  };
}

