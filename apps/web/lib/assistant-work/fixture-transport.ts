import type { FixtureOptions, PlanOutcome, WorkTransport } from "./client";
import { ACTIVITY_JSON, IMPORT_CONFIRM_PLAN_JSON, IMPORT_DRAFT_JSON, IMPORT_PLAN_JSON, IMPORT_PRICES_JSON } from "./fixtures";
import { fileKindOf, parseActivityEntry, parseImportDraft, parsePlan, parseUploadedFile, type ActivityEntry, type ImportCounts, type ImportDraft, type WorkPlan } from "./types";

/** The made-up answers themselves (lib/assistant-work/client.ts `fixtureTransport` loads this file on first use): Do it / Undo move the plans it knows through their states. Nothing leaves the page. */
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
  // the editable import: one made-up draft, kept here so edits and the include boxes change it (the same revalidation the API does: an edited cell is no longer unsure, a phone is checked)
  let draft: ImportDraft | null = parseImportDraft(IMPORT_DRAFT_JSON);
  const countsOf = (d: ImportDraft): ImportCounts => ({ rows: d.rows.length, new: d.rows.filter((r) => r.include).length, existing: d.rows.filter((r) => r.duplicateOf !== null).length, invalidPhone: d.rows.filter((r) => r.invalidPhone).length, unsure: d.rows.filter((r) => Object.values(r.cells).some((c) => c.unsure)).length });
  return {
    async upload(file, onProgress, signal) {
      for (const f of [0.25, 0.5, 0.75, 1]) {
        if (signal.aborted) return { ok: false, error: "aborted" };
        await wait(delay);
        if (options.uploadDown && f >= 0.5) return { ok: false, error: "down" };
        onProgress(f);
      }
      if (signal.aborted) return { ok: false, error: "aborted" };
      // the contract's answer (201 {file_id, name, size_bytes, kind, expires_at}); the kind is judged here by the name and the browser's type (the API reads the first bytes)
      const parsed = parseUploadedFile({ file_id: fixedId(++uploads), name: file.name, size_bytes: file.size, kind: fileKindOf(file.name, file.type) ?? "text", expires_at: null });
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
    async undoTalkPrefs(token) {
      await wait(delay);
      return token.length >= 8 ? { ok: true } : { ok: false, error: "expired" };
    },
    async importGet(importId) {
      await wait(delay);
      return draft && draft.importId === importId ? { ok: true, draft } : { ok: false, error: "gone" };
    },
    async importEdit(importId, change) {
      await wait(delay);
      if (!draft || draft.importId !== importId) return { ok: false, error: "gone" };
      if (draft.state !== "ready") return { ok: false, error: "state" };
      let bad = false;
      const rows = draft.rows.map((r) => {
        let row = r;
        for (const e of change.edits.filter((x) => x.rowId === r.rowId)) {
          if (!row.cells[e.cell]) {
            bad = true;
            continue;
          }
          const isPhone = e.cell === "phone";
          const digits = e.value.replace(/\D/g, "");
          const valid = isPhone ? /^(91)?[6-9]\d{9}$/.test(digits) : null;
          const value = isPhone && valid ? `+91${digits.slice(-10)}` : e.value;
          row = { ...row, cells: { ...row.cells, [e.cell]: { value, unsure: false, valid } }, invalidPhone: isPhone ? !valid : row.invalidPhone, include: isPhone && valid && r.invalidPhone ? true : row.include };
        }
        const inc = change.include.find((x) => x.rowId === r.rowId);
        return inc ? { ...row, include: inc.include } : row;
      });
      if (bad) return { ok: false, error: "invalid" };
      draft = { ...draft, rows, counts: countsOf({ ...draft, rows }) };
      return { ok: true, counts: draft.counts };
    },
    async importConfirm(importId, consentSource) {
      await wait(delay);
      if (!draft || draft.importId !== importId) return { ok: false, error: "gone" };
      if (draft.state !== "ready") return { ok: false, error: "state" };
      if (draft.consent?.required && consentSource === null) return { ok: false, error: "consent" };
      draft = { ...draft, state: "importing" };
      const plan = parsePlan(IMPORT_CONFIRM_PLAN_JSON);
      if (!plan) return { ok: false, error: "down" };
      const made = { ...plan, title: `Add ${draft.rows.filter((r) => r.include).length} new leads from IMG_2041.jpg` };
      known.set(made.planId, made);
      return { ok: true, plan: made };
    },
    async importDestination(importId, destination) {
      await wait(delay);
      if (!draft || draft.importId !== importId) return { ok: false, error: "gone" };
      if (draft.state !== "ready") return { ok: false, error: "state" };
      const next = parseImportDraft(destination === "leads" ? IMPORT_DRAFT_JSON : { ...IMPORT_PRICES_JSON, destination });
      if (!next) return { ok: false, error: "down" };
      draft = next;
      return { ok: true, draft };
    },
    async importCancel(importId) {
      await wait(delay);
      if (!draft || draft.importId !== importId) return { ok: false, error: "gone" };
      draft = { ...draft, state: "cancelled", rows: [] };
      return { ok: true };
    },
  };
  function remember(plan: WorkPlan): PlanOutcome {
    known.set(plan.planId, plan);
    return { ok: true, plan };
  }
}
