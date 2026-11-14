import { parseActivityEntry, parseImportDraft, parsePlan, parseTestResult, parseUploadedFile, type ActivityEntry, type ConsentSource, type Destination, type ImportCounts, type ImportDraft, type LiveTest, type TestResult, type UploadedFile, type WorkPlan } from "./types";

/**
 * The browser's side calls of the assistant's work cards. Two transports with ONE shape:
 *   routeTransport(base): this workspace's own route `<base>/assistant-work` (JSON, one op each) and `<base>/assistant-work/upload` (the file as the body), which hold the person's token and call the API
 *     (C1's contract, docs/contracts/assistant-tools.md; lib/api/assistant-work.ts has the API routes);
 *   fixtureTransport(): made-up answers in the browser, no network at all (the tests, the preview page and ASSISTANT_WORK_SCREENS=mock: nothing is uploaded anywhere).
 * Every answer is a closed word on failure; the API's own English is never shown.
 */
export type PlanOutcome = { ok: true; plan: WorkPlan } | { ok: false; error: "mfa" | "forbidden" | "expired" | "state" | "down" };
export type UploadOutcome = { ok: true; file: UploadedFile } | { ok: false; error: "size" | "type" | "empty" | "unsafe" | "forbidden" | "down" | "aborted" };
export type SecretOutcome = { ok: true; last4: string | null } | { ok: false; error: "rejected" | "forbidden" | "renew" | "down" };
export type TestOutcome = { ok: true; result: TestResult } | { ok: false; error: "forbidden" | "down" };
export type TalkUndoOutcome = { ok: true } | { ok: false; error: "expired" | "changed" | "down" };
export type UndoOutcome = { ok: true; entry: ActivityEntry } | { ok: false; error: "expired" | "forbidden" | "down" };

/** The editable import (contract file-import.md section 4): why a call was refused, as a closed word: `state` (already imported or cancelled), `consent` (a consent source is needed), `invalid` (a bad edit), `gone` (not yours, or deleted). */
export type ImportError = "state" | "consent" | "invalid" | "not_yet" | "nothing" | "real_data" | "gone" | "forbidden" | "down";
export type ImportOutcome = { ok: true; draft: ImportDraft } | { ok: false; error: ImportError };
export type ImportEditOutcome = { ok: true; counts: ImportCounts } | { ok: false; error: ImportError };
export type ImportConfirmOutcome = { ok: true; plan: WorkPlan } | { ok: false; error: ImportError };
export type ImportCancelOutcome = { ok: true } | { ok: false; error: ImportError };
/** Taking a message back inside its hold (`POST /outbox/messages/{id}/unsend`): `late` = it is already on its way (409 outbox_state). */
export type MessageUndoOutcome = { ok: true } | { ok: false; error: "late" | "forbidden" | "down" };
/** Where a message is now, read from the outbox: `delivery` is the newest receipt the outbox has (sent, delivered, read). */
export type MessageStatusOutcome = { ok: true; status: "queued" | "sent" | "blocked" | "failed" | "waiting"; delivery: "sent" | "delivered" | "read" | null } | { ok: false };
export type ImportEdits = { edits: { rowId: string; cell: string; value: string }[]; include: { rowId: string; include: boolean }[] };

export type WorkTransport = {
  upload(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<UploadOutcome>;
  decide(planId: string, decision: "do" | "cancel", confirmed: boolean): Promise<PlanOutcome>;
  undo(planId: string): Promise<PlanOutcome>;
  /** The value is passed straight through to the request body and dropped: never kept, never logged. */
  saveSecret(requestId: string, value: string): Promise<SecretOutcome>;
  liveTest(setupId: string, test: LiveTest): Promise<TestOutcome>;
  undoAction(actionId: string): Promise<UndoOutcome>;
  /** The Undo of a "How it talks to you" card (the token the card carried; the answer is not kept). */
  undoTalkPrefs(token: string): Promise<TalkUndoOutcome>;
  /** The editable preview of a file: a page of rows, an edit, the confirm (with the consent source) that gives the plan, and delete (the file and its rows go at once). */
  importGet(importId: string, cursor: string | null): Promise<ImportOutcome>;
  importEdit(importId: string, change: ImportEdits): Promise<ImportEditOutcome>;
  importConfirm(importId: string, consentSource: ConsentSource | null, excludeRowIds: readonly string[]): Promise<ImportConfirmOutcome>;
  importCancel(importId: string): Promise<ImportCancelOutcome>;
  /** Send the same file somewhere else (leads, catalogue, prices): the whole card comes back re-mapped; edits are kept where the cell still exists. Only while the import is ready. */
  importDestination(importId: string, destination: Destination): Promise<ImportOutcome>;
  /** The message card: take it back inside its hold, and read where it is now. */
  messageUndo(messageId: string): Promise<MessageUndoOutcome>;
  messageStatus(messageId: string): Promise<MessageStatusOutcome>;
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

const IMPORT_ERRORS = ["state", "consent", "invalid", "not_yet", "nothing", "real_data", "gone", "forbidden"] as const;
const importError = (json: Record<string, unknown> | null): { ok: false; error: ImportError } => ({ ok: false, error: (IMPORT_ERRORS as readonly unknown[]).includes(json?.error) ? (json?.error as (typeof IMPORT_ERRORS)[number]) : "down" });
const wholeNumber = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

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
      resolve({ ok: false, error: e === "size" || e === "type" || e === "empty" || e === "unsafe" || e === "forbidden" ? e : "down" });
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
    undoTalkPrefs: async (token) => {
      const json = await op(base, { op: "undo_talk_prefs", token }, fetcher);
      return json?.ok === true ? { ok: true } : { ok: false, error: json?.error === "expired" || json?.error === "changed" ? json.error : "down" };
    },
    importGet: async (importId, cursor) => {
      const json = await op(base, { op: "import_get", importId, cursor }, fetcher);
      const draft = json?.ok === true ? parseImportDraft(json.draft) : null;
      return draft ? { ok: true, draft } : importError(json);
    },
    importEdit: async (importId, change) => {
      const json = await op(base, { op: "import_edit", importId, edits: change.edits, include: change.include }, fetcher);
      if (json?.ok === true && isRec(json.counts)) return { ok: true, counts: { rows: wholeNumber(json.counts.rows), new: wholeNumber(json.counts.new), existing: wholeNumber(json.counts.existing), invalidPhone: wholeNumber(json.counts.invalid_phone), unsure: wholeNumber(json.counts.unsure) } };
      return importError(json);
    },
    importConfirm: async (importId, consentSource, excludeRowIds) => {
      const json = await op(base, { op: "import_confirm", importId, consentSource, excludeRowIds }, fetcher);
      const plan = json?.ok === true ? parsePlan(json.plan) : null;
      return plan ? { ok: true, plan } : importError(json);
    },
    importCancel: async (importId) => {
      const json = await op(base, { op: "import_cancel", importId }, fetcher);
      return json?.ok === true ? { ok: true } : importError(json);
    },
    messageUndo: async (messageId) => {
      const json = await op(base, { op: "message_undo", messageId }, fetcher);
      return json?.ok === true ? { ok: true } : { ok: false, error: json?.error === "late" || json?.error === "forbidden" ? json.error : "down" };
    },
    messageStatus: async (messageId) => {
      const json = await op(base, { op: "message_status", messageId }, fetcher);
      const status = json?.status;
      if (json?.ok !== true || !(status === "queued" || status === "sent" || status === "blocked" || status === "failed" || status === "waiting")) return { ok: false };
      return { ok: true, status, delivery: json.delivery === "sent" || json.delivery === "delivered" || json.delivery === "read" ? json.delivery : null };
    },
    importDestination: async (importId, destination) => {
      const json = await op(base, { op: "import_destination", importId, destination }, fetcher);
      const draft = json?.ok === true ? parseImportDraft(json.draft) : null;
      return draft ? { ok: true, draft } : importError(json);
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
    undoTalkPrefs: async (token) => (await get()).undoTalkPrefs(token),
    importGet: async (importId, cursor) => (await get()).importGet(importId, cursor),
    importEdit: async (importId, change) => (await get()).importEdit(importId, change),
    importConfirm: async (importId, consentSource, excludeRowIds) => (await get()).importConfirm(importId, consentSource, excludeRowIds),
    importCancel: async (importId) => (await get()).importCancel(importId),
    importDestination: async (importId, destination) => (await get()).importDestination(importId, destination),
    messageUndo: async (messageId) => (await get()).messageUndo(messageId),
    messageStatus: async (messageId) => (await get()).messageStatus(messageId),
  };
}

