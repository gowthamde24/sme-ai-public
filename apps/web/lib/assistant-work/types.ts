/**
 * "The assistant does the work" (job assistant-does-the-work, C2's part): the shapes the chat's cards and Settings > Activity read, in ONE place, with their parsers.
 *
 * The wire shapes are C1's contract, docs/contracts/assistant-tools.md (published 4 Nov 2026, branch aw-files / PR #314), field for field. The API's JSON is snake_case; the screens read camelCase.
 * Every parser is strict about what it keeps: a field of the wrong type is a closed fallback (left out, or the card is not drawn), never a guess; text is capped; a link is kept only when it points
 * inside the workspace. A card of a kind this screen does not know is skipped (never drawn, never a crash).
 *
 * Nothing here holds a secret: a secret card carries what to ask for, never the value; after a save it knows the last four characters at most.
 */

// ---- files in the chat ------------------------------------------------------------------------------------------------

/**
 * What the "+" menu and drag-and-drop accept: the contract's kinds (section 1). sheet = Excel, CSV, TSV, OpenDocument; pdf; image = JPG, PNG, HEIC/HEIF (a phone's photo); doc = Word (.docx);
 * contacts = a contact card (.vcf); text. Today only sheets, contact cards and text become leads: a PDF, a photo or a Word file is answered with "can't do yet" (`cant_do`, `not_yet`).
 */
export const FILE_EXTENSIONS = [".xlsx", ".xls", ".csv", ".tsv", ".ods", ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".docx", ".vcf", ".txt"] as const;

const KIND_OF_EXT: Readonly<Record<string, FileKind>> = { xlsx: "sheet", xls: "sheet", csv: "sheet", tsv: "sheet", ods: "sheet", pdf: "pdf", jpg: "image", jpeg: "image", png: "image", heic: "image", heif: "image", docx: "doc", vcf: "contacts", txt: "text" };
/** The browser's type of each kind, for a file whose name has NO extension (a phone's camera or share sheet): the extension, when there is one, always decides. */
const KIND_OF_TYPE: Readonly<Record<string, FileKind>> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.oasis.opendocument.spreadsheet": "sheet",
  "text/csv": "sheet",
  "text/tab-separated-values": "sheet",
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/heic": "image",
  "image/heif": "image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "text/vcard": "contacts",
  "text/x-vcard": "contacts",
  "text/plain": "text",
};
/** The `accept` of the file picker: the extensions and their usual types (a phone's picker filters by type). */
export const FILE_ACCEPT = [...FILE_EXTENSIONS, ...Object.keys(KIND_OF_TYPE)].join(",");
/** 10 MB (the contract: the API's request limit is 20 MB and base64 is 4/3 bigger), checked in the browser BEFORE anything is uploaded (the API checks again). */
export const MAX_FILE_MB = 10;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
/** At most this many files wait beside one message (the contract: 5 per message). */
export const MAX_FILES = 5;

export const FILE_KINDS = ["sheet", "pdf", "image", "doc", "contacts", "text"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
/** The kinds the assistant cannot read yet (the contract: pdf, image, doc -> `cant_do`, `not_yet`). */
export const NOT_YET_KINDS: readonly FileKind[] = ["pdf", "image", "doc"];

/**
 * The kind of a file, or null when it is not one the chat takes. The extension decides (a browser's type is often EMPTY for .heic, .heif, .vcf and .xls); only a name without any extension is
 * judged by the browser's type. A name with an extension the chat does not take (.exe, .xlsm, .doc) is refused whatever its type says. The API decides again by the first bytes.
 */
export function fileKindOf(name: string, type?: string | null): FileKind | null {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot > 0) return KIND_OF_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
  const t = (type ?? "").split(";")[0].trim().toLowerCase();
  return KIND_OF_TYPE[t] ?? null;
}

/** Why a file was not taken, before any upload. */
export type FileRefusal = "type" | "size" | "empty" | "count";

/** The check the chat makes before an upload starts. */
export function checkFile(file: { name: string; size: number; type?: string }, waiting: number): FileRefusal | null {
  if (waiting >= MAX_FILES) return "count";
  if (fileKindOf(file.name, file.type) === null) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_FILE_BYTES) return "size";
  return null;
}

/** "1.2 MB", "340 KB", "900 B": the size on a chip, in digits every language reads. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * The contract, section 1: `POST /v1/tenants/{id}/assistant/files` (JSON `{name, content_type, size_bytes, data_base64}`: the API takes no multipart, like the lead import)
 * -> 201 `{file_id, name, size_bytes, kind, expires_at}`; refusals 413 `file_too_large`, 415 `file_type`, 422 `file_empty`. The kind is the API's (the first bytes win over the name). The file is kept
 * only as long as the import needs it, at most 24 h (DPDP). The browser never calls the API: `<base>/assistant-work/upload` does, with the token.
 */
export type UploadedFile = { fileId: string; name: string; size: number; kind: FileKind; expiresAt: string | null };

// ---- the cards of a turn ----------------------------------------------------------------------------------------------

/** Where the assistant will put what it found in a file. */
export const DESTINATIONS = ["leads", "catalogue", "knowledge", "customer"] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** The counts a preview may say, each with its own words ("38 found · 4 already exist · 2 no phone · 1 looks like a supplier"). A code this screen does not know is left out. */
export const PREVIEW_FACTS = ["found", "existing", "no_phone", "supplier", "no_price", "duplicate", "unreadable", "too_many"] as const;
export type PreviewFact = (typeof PREVIEW_FACTS)[number];

/** Why a plan is sensitive (job: money, sending/calling, members/roles, deleting, billing, secrets). A sensitive plan needs the Owner's explicit second confirm. */
export const SENSITIVE_REASONS = ["money", "sending", "members", "deleting", "billing", "secrets"] as const;
export type SensitiveReason = (typeof SENSITIVE_REASONS)[number];

export const STEP_STATUSES = ["proposed", "running", "done", "failed", "skipped", "undone"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const PLAN_STATUSES = ["proposed", "running", "done", "partly_done", "failed", "cancelled", "undone", "expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
/** Why a step failed, in words the card has a sentence for (anything else is the general one). */
export const STEP_ERRORS = ["forbidden", "invalid", "conflict", "not_found", "limit", "down"] as const;
export type StepError = (typeof STEP_ERRORS)[number];

/** One step of a plan: one tool, with its summary in the person's language (the tool's i18n summary text, made by the API). */
export type WorkStep = { tool: string; summary: string; undoable: boolean; status: StepStatus; error: StepError | null };

/**
 * The contract, section 2 (`plan`): a plan of 1 to 20 tools, in order; it expires 30 minutes after it was proposed. `ownerOnly` = only the Owner may say "Do it" (always true for a sensitive plan).
 * Decide: `POST /assistant/plans/{plan_id}/decide` `{decision: "do" | "cancel", confirmed: bool}` -> the plan (409 `confirm_needed`, `plan_state`, `plan_expired`; 403 `mfa_required`, forbidden).
 * Undo: `POST /assistant/plans/{plan_id}/undo` -> the plan (409 `nothing_to_undo`, `plan_state`; 403 forbidden: archiving is the Owner's or an Admin's).
 */
export type WorkPlan = {
  planId: string;
  title: string;
  steps: WorkStep[];
  sensitive: SensitiveReason | null;
  ownerOnly: boolean;
  needsSecondFactor: boolean;
  status: PlanStatus;
  expiresAt: string | null;
};

/**
 * The preview of a file: what was found, a few sample rows, where it will go, and the plan that would put it there (`null` when nobody new is in it). The rows come at the turn only: a replay
 * gives `rows: []` (DPDP).
 */
export const READ_BY = ["file", "local_ocr", "ai"] as const;
export type ReadBy = (typeof READ_BY)[number];
export type FilePreviewCard = {
  kind: "file_preview";
  id: string;
  fileName: string;
  destination: Destination;
  /** "attach to a customer": whose file it becomes. */
  customerName: string | null;
  /** How it was read (job A3): the file's own cells or text, our server reading a scan or photo (`local_ocr`), or the AI model reading the page images (`ai`). An older card has none: `file`. */
  readBy: ReadBy;
  facts: { code: PreviewFact; n: number }[];
  columns: string[];
  rows: string[][];
  plan: WorkPlan | null;
};

export type WorkPlanCard = { kind: "plan"; id: string; plan: WorkPlan };

/** What a secret card asks for (the label comes from the card's own words; `other` uses the API's title). */
export const SECRET_KINDS = ["indiamart_key", "justdial_key", "whatsapp_token", "smtp_password", "sheet_key", "other"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/**
 * The contract, section 2 (`secret`): the assistant needs a key. The card has its own `id` and a `request_id`; the value goes ONLY to `POST /assistant/secrets/{request_id}` `{value}`
 * -> `{saved: true, last4: "1a2b" | null}` (Owner only; good for 15 minutes, once), through `<base>/assistant-work` (the token stays on the server). It is never part of the conversation, never
 * sent to the model, never logged; the card knows "saved" and at most the last four.
 */
export type SecretCard = { kind: "secret"; id: string; requestId: string; secret: SecretKind; title: string; hint: string | null; saved: { last4: string | null } | null };

/** The guided setups (job design 4). */
export const SETUP_KINDS = ["indiamart", "email_forward", "website_form", "google_sheet", "voice_language", "calling_hours", "followup_rules", "team_invite"] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];
export const LIVE_TESTS = ["send_test_lead", "pull_now", "test_call", "send_test_mail"] as const;
export type LiveTest = (typeof LIVE_TESTS)[number];
/** Why a live test failed, in words the card has a sentence for (with the API's own detail as plain text under it). */
export const TEST_REASONS = ["no_key", "key_rejected", "nothing_arrived", "form_not_found", "sheet_not_shared", "not_reachable", "timeout", "other"] as const;
export type TestReason = (typeof TEST_REASONS)[number];
export type TestResult = { ok: boolean; reason: TestReason | null; detail: string | null; at: string | null };

/**
 * The contract, section 2 (`setup`): a step card of a guided setup. `copy` = values to copy (the forwarding address, the website snippet); `portals` = per-portal steps
 * (IndiaMART, JustDial, TradeIndia...); `secret` = a secret card to fill on the card itself. Live test: `POST /assistant/setups/{id}/test` `{test}` -> `{ok, reason, detail, at}`.
 */
export type SetupCard = {
  kind: "setup";
  id: string;
  setup: SetupKind;
  title: string;
  steps: string[];
  copy: { label: string; value: string; code: boolean }[];
  portals: { name: string; steps: string[] }[];
  secret: SecretCard | null;
  test: LiveTest | null;
  lastTest: TestResult | null;
  screen: { label: string; href: string } | null;
};

/**
 * "Can't do yet" (honest, never pretending): `not_yet` = no tool for it yet (a PDF, a photo or a Word file in the chat; a price list from a file); `screen_only` = always a screen and a person
 * (the real-data gate, billing, deleting a workspace). `what` is the API's words for the thing asked ("Opening the real-data gate").
 */
export const CANT_REASONS = ["not_yet", "screen_only", "not_in_plan"] as const;
/** The product a `not_in_plan` card points to (the contract, PR #317: only AI Workforce today). */
export const UPGRADE_PRODUCTS = ["ai_workforce"] as const;
export type UpgradeProduct = (typeof UPGRADE_PRODUCTS)[number];
/**
 * `not_in_plan` (C1's PR #317, owner decision 4 Nov 2026): the thing asked ("find new retailers ...") is part of AI Workforce and this workspace is on Lead Desk: a friendly card with `upgradeTo`
 * and the Plans link; no price, no checkout, nothing is charged. `upgradeTo` comes only with `not_in_plan`.
 */
export type CantDoCard = { kind: "cant_do"; id: string; reason: (typeof CANT_REASONS)[number]; what: string; screen: { label: string; href: string } | null; upgradeTo: UpgradeProduct | null };

export type WorkCard = FilePreviewCard | WorkPlanCard | SecretCard | SetupCard | CantDoCard;

// ---- Settings > Activity ----------------------------------------------------------------------------------------------

export const UNDO_STATES = ["available", "done", "none", "expired"] as const;
export type UndoState = (typeof UNDO_STATES)[number];
/**
 * The contract, section 3: `GET /assistant/actions?since=<iso>&before=<iso>&limit=50` -> `{items: [{action_id, tool, summary, changed, requested_by, message_id, at, status, undo}], next_before}`
 * (Owner, Admin). Every entry is "by the assistant, on <requested_by>'s request". Undo: `POST /assistant/actions/{action_id}/undo` -> the entry (offered for 7 days, then `undo: "expired"`).
 */
export type ActivityEntry = { actionId: string; tool: string; summary: string; changed: string | null; requestedBy: string | null; messageId: string | null; at: string; status: "done" | "failed" | "undone"; undo: UndoState };

// ---- parsers ----------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);
const one = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const strings = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.slice(0, n).map((x) => (typeof x === "string" ? x.slice(0, max) : "")).filter((x) => x !== "") : []);

/** A link is kept only when it is a path inside THIS workspace (`base` = `/app/tenants/<id>`); anything else (another site, another workspace, a scheme) is dropped. */
export function insideBase(href: unknown, base: string): string | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\") || href.includes("..")) return null;
  const full = href.startsWith("/app/") ? href : `${base}${href}`;
  return full === base || full.startsWith(`${base}/`) || full.startsWith(`${base}?`) ? full.slice(0, 400) : null;
}

/**
 * The API's screen paths that are drawn somewhere else in this web app (the contract names a screen by its own path): About my business is a tab of Settings > AI assistant, and Settings -> Data
 * is a section of Settings. Any other path is used as it is.
 */
const SCREEN_ALIASES: Readonly<Record<string, string>> = { "/settings/knowledge": "/settings?section=assistant#knowledge", "/settings/data": "/settings?section=data" };

const link = (v: unknown, base: string): { label: string; href: string } | null => {
  if (!isRec(v)) return null;
  const label = str(v.label, 120);
  const href = insideBase(typeof v.href === "string" ? (SCREEN_ALIASES[v.href] ?? v.href) : v.href, base);
  return label && href ? { label, href } : null;
};

export function parseUploadedFile(json: unknown): UploadedFile | null {
  if (!isRec(json)) return null;
  const fileId = id(json.file_id);
  const name = str(json.name, 200);
  const size = count(json.size_bytes);
  const kind = one(FILE_KINDS, json.kind);
  if (!fileId || !name || size === null || !kind) return null;
  return { fileId, name, size, kind, expiresAt: str(json.expires_at, 60) };
}

export function parsePlan(json: unknown): WorkPlan | null {
  if (!isRec(json)) return null;
  const planId = id(json.plan_id);
  const title = str(json.title, 300);
  const status = one(PLAN_STATUSES, json.status); // the contract always says the state: a plan without one is not drawn (it could have run already)
  if (!planId || !title || !status || !Array.isArray(json.steps) || json.steps.length === 0 || json.steps.length > 20) return null;
  const steps: WorkStep[] = [];
  for (const s of json.steps) {
    if (!isRec(s)) return null;
    const tool = str(s.tool, 80);
    const summary = str(s.summary, 400);
    const st = one(STEP_STATUSES, s.status);
    if (!tool || !summary || !st) return null;
    steps.push({ tool, summary, undoable: s.undoable === true, status: st, error: st === "failed" ? (one(STEP_ERRORS, s.error) ?? "down") : null });
  }
  const sensitive = json.sensitive === null || json.sensitive === undefined ? null : one(SENSITIVE_REASONS, json.sensitive);
  if (json.sensitive !== null && json.sensitive !== undefined && sensitive === null) return null; // an unknown kind of sensitive is NOT treated as harmless: the card is not drawn
  return { planId, title, steps, sensitive, ownerOnly: sensitive !== null || json.owner_only === true, needsSecondFactor: json.needs_second_factor === true, status, expiresAt: str(json.expires_at, 60) };
}

/** A secret card (on its own, or inside a setup card): the card's `id` and the `request_id` the value goes to are both needed. */
function parseSecret(v: Record<string, unknown>): SecretCard | null {
  const cardId = id(v.id);
  const requestId = id(v.request_id);
  const secret = one(SECRET_KINDS, v.secret);
  const title = str(v.title, 200);
  if (!cardId || !requestId || !secret || !title) return null;
  const last4 = isRec(v.saved) && typeof v.saved.last4 === "string" && /^[\w-]{4}$/.test(v.saved.last4) ? v.saved.last4 : null;
  return { kind: "secret", id: cardId, requestId, secret, title, hint: str(v.hint, 400), saved: isRec(v.saved) ? { last4 } : null };
}

export function parseTestResult(json: unknown): TestResult | null {
  if (!isRec(json) || typeof json.ok !== "boolean") return null;
  return { ok: json.ok, reason: json.ok ? null : (one(TEST_REASONS, json.reason) ?? "other"), detail: str(json.detail, 400), at: str(json.at, 60) };
}

/**
 * One card of a turn, the contract's section 2: the server-sent event `work_card` `{type: "work_card", card: {kind, id, ...}}` of `POST /assistant/turns`, after the sentence and before `done`.
 * Every card has its own stable `id`. The same parser reads it on the server (lib/api/turns.ts) and again in the browser (transport.ts): the card's text is untrusted (it can quote a customer's
 * file) and is drawn as plain text. A kind this screen does not know, or a card without its id, is skipped (null).
 */
export function parseWorkCard(json: unknown, base: string): WorkCard | null {
  if (!isRec(json)) return null;
  const cardId = id(json.id);
  if (!cardId) return null;
  switch (json.kind) {
    case "file_preview": {
      const fileName = str(json.file_name, 200);
      const destination = one(DESTINATIONS, json.destination);
      if (!fileName || !destination) return null;
      const facts: { code: PreviewFact; n: number }[] = [];
      for (const f of Array.isArray(json.facts) ? json.facts.slice(0, 20) : []) {
        const code = isRec(f) ? one(PREVIEW_FACTS, f.code) : null;
        const n = isRec(f) ? count(f.n) : null;
        if (code && n !== null && !facts.some((x) => x.code === code)) facts.push({ code, n }); // a code it has no words for is left out; a repeated code counts once
      }
      facts.sort((a, b) => PREVIEW_FACTS.indexOf(a.code) - PREVIEW_FACTS.indexOf(b.code));
      const columns = strings(json.columns, 8, 60);
      const rows = Array.isArray(json.rows) ? json.rows.slice(0, 5).filter(Array.isArray).map((r) => (r as unknown[]).slice(0, columns.length || 8).map((c) => (typeof c === "string" ? c.slice(0, 120) : typeof c === "number" ? String(c) : ""))) : [];
      const plan = json.plan === null || json.plan === undefined ? null : parsePlan(json.plan);
      if (plan === null && json.plan !== null && json.plan !== undefined) return null; // a plan that does not read is not shown as "nobody new in it"
      return { kind: "file_preview", id: cardId, fileName, destination, customerName: destination === "customer" ? str(json.customer_name, 120) : null, readBy: one(READ_BY, json.read_by) ?? "file", facts, columns, rows, plan };
    }
    case "plan": {
      const plan = parsePlan(json.plan);
      return plan ? { kind: "plan", id: cardId, plan } : null;
    }
    case "secret":
      return parseSecret(json);
    case "setup": {
      const setup = one(SETUP_KINDS, json.setup);
      const title = str(json.title, 200);
      if (!setup || !title) return null;
      const copy = Array.isArray(json.copy) ? json.copy.slice(0, 4).filter(isRec).flatMap((c) => (str(c.label, 120) && typeof c.value === "string" && c.value.length <= 4000 ? [{ label: str(c.label, 120) as string, value: c.value, code: c.code === true }] : [])) : [];
      const portals = Array.isArray(json.portals) ? json.portals.slice(0, 8).filter(isRec).flatMap((p) => (str(p.name, 60) ? [{ name: str(p.name, 60) as string, steps: strings(p.steps, 10, 300) }] : [])) : [];
      return {
        kind: "setup",
        id: cardId,
        setup,
        title,
        steps: strings(json.steps, 12, 400),
        copy,
        portals,
        secret: isRec(json.secret) ? parseSecret(json.secret) : null,
        test: json.test === null || json.test === undefined ? null : one(LIVE_TESTS, json.test),
        lastTest: json.last_test === null || json.last_test === undefined ? null : parseTestResult(json.last_test),
        screen: link(json.screen, base),
      };
    }
    case "cant_do": {
      const what = str(json.what, 400);
      const reason = one(CANT_REASONS, json.reason);
      if (!what || !reason) return null;
      const upgradeTo = reason === "not_in_plan" ? one(UPGRADE_PRODUCTS, json.upgrade_to) : null;
      if (reason === "not_in_plan" && upgradeTo === null) return null; // an upgrade to a product this screen has no words for is not drawn (never a made-up name)
      return { kind: "cant_do", id: cardId, reason, what, screen: link(json.screen, base), upgradeTo };
    }
    default:
      return null;
  }
}

export function parseActivityEntry(json: unknown): ActivityEntry | null {
  if (!isRec(json)) return null;
  const actionId = id(json.action_id);
  const tool = str(json.tool, 80);
  const summary = str(json.summary, 400);
  const at = str(json.at, 60);
  const status = one(["done", "failed", "undone"] as const, json.status);
  if (!actionId || !tool || !summary || !at || Number.isNaN(Date.parse(at)) || !status) return null;
  return { actionId, tool, summary, changed: str(json.changed, 400), requestedBy: str(json.requested_by, 120), messageId: id(json.message_id), at, status, undo: one(UNDO_STATES, json.undo) ?? "none" };
}

export function parseActivity(json: unknown): { items: ActivityEntry[]; nextBefore: string | null } | null {
  if (!isRec(json) || !Array.isArray(json.items)) return null;
  return { items: json.items.slice(0, 100).map(parseActivityEntry).filter((x): x is ActivityEntry => x !== null), nextBefore: str(json.next_before, 60) };
}

/** The start of "today" or "this week" (Monday) in India time, as an ISO instant: the Activity filter's `since`. */
export function sinceFor(range: "today" | "week", now: number): string {
  const IST = 5.5 * 3600_000;
  const local = new Date(now + IST);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const back = range === "week" ? ((local.getUTCDay() + 6) % 7) * 86400_000 : 0;
  return new Date(day - back - IST).toISOString();
}
