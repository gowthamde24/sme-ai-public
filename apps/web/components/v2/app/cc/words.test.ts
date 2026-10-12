import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { STOCK_STATUSES } from "@/lib/api/catalogue";
import { EXPORT_FORMATS } from "@/lib/api/data";

import { FIELD_WORDS, ISSUES, NOTES, PREVIEW_COUNTS, REASONS, RESULT_COUNTS, STATUSES } from "../data/import-model";
import { INVITATION_STATUSES, INVITED_ROLES, ROLES } from "@/lib/api/team";
import { REASONS as REMOVE_REASONS, TEAM_CODES } from "../team/team-model";
import { DELIVERY_ERRORS, FAILURE_CODES, STATE_TONE, WA_CODES } from "../whatsapp/wa-model";
import { FAILURE_KEY } from "./kit";

/**
 * Job CC: the new screens say their words through the string store. Two pins (the words-coverage test of job BK covers the pages under app/app; this covers the parts they draw):
 *  1. every `t("literal.key")` in these folders exists in the store (a missing key would show the raw key to a person);
 *  2. every key built from a closed word (`dta.status.${code}`) exists for every word of the closed list.
 */
const WEB = process.cwd();
const FOLDERS = ["components/v2/app/cc", "components/v2/app/data", "components/v2/app/privacy", "components/v2/app/retailers", "components/v2/app/team", "components/v2/app/whatsapp", "components/v2/app/gstin"];
function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(dir, e.name)] : []));
}
const en = appDict("en") as Record<string, string>;

describe("the words of the job CC screens", () => {
  it("every literal key asked of the store exists", () => {
    const missing: string[] = [];
    for (const folder of FOLDERS) {
      for (const f of files(path.join(WEB, folder))) {
        const src = fs.readFileSync(f, "utf8");
        for (const m of src.matchAll(/\bt\(\s*["']([a-z][a-z0-9_]*(?:\.[A-Za-z0-9_]+)+)["']/g)) if (!(m[1] in en)) missing.push(`${path.relative(WEB, f)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("every closed word of the import has its words", () => {
    const need = [...STATUSES.map((s) => `dta.status.${s}`), ...REASONS.map((r) => `dta.reason.${r}`), ...NOTES.map((n) => `dta.note.${n}`), ...ISSUES.map((i) => `dta.issue.${i}`), ...FIELD_WORDS.map((f) => `dta.field.${f}`), ...EXPORT_FORMATS.map((f) => `dta.fmt.${f}`),
      ...[...PREVIEW_COUNTS.customers, ...PREVIEW_COUNTS.stock, ...RESULT_COUNTS.customers, ...RESULT_COUNTS.stock].map((c) => `dta.status.${c}`),
      ...["previewed", "completed", "failed"].map((s) => `dta.jobs.${s}`),
      ...["exact", "partial", "weak", "none"].map((c) => `dta.conf.${c}`),
      ...STOCK_STATUSES.map((c) => `catalogue.stock.${c}`),
      ...["customers", "stock"].map((k) => `dta.kind.${k}`),
      ...["tally", "vyapar", "sheet"].map((k) => `dta.src.tip.${k}`),
      ...ROLES.map((r) => `team.role.${r}`),
      ...INVITED_ROLES.map((r) => `team.role.help.${r}`),
      ...REMOVE_REASONS.map((r) => `team.reason.${r}`),
      ...INVITATION_STATUSES.map((s) => `team.inv.status.${s}`),
      ...TEAM_CODES.map((c) => `team.err.${c}`),
      ...DELIVERY_ERRORS.map((c) => `wa.derr.${c}`),
      ...FAILURE_CODES.map((c) => `wa.fcode.${c}`),
      ...WA_CODES.map((c) => `wa.err.${c}`),
      ...Object.keys(STATE_TONE).map((s) => `wa.state.${s}`),
      ...["not_connected", "connecting", "connected"].map((s) => `wa.state.${s}.body`),
      ...["disabled", "token_missing"].map((s) => `wa.state.needs_attention.${s}`),
      ...["waiting", "queued", "sent", "delivered", "read", "blocked", "failed"].map((s) => `wa.out.${s}`),
      ...["draft", "submitted", "approved", "rejected", "paused", "disabled"].map((s) => `wa.tpl.status.${s}`),
      ...["followup", "visit", "order_status", "info"].map((s) => `wa.tpl.purpose.${s}`),
      ...["waba", "phone", "token"].map((s) => `wa.form.bad.${s}`),
      ...[1, 2, 3, 4].map((n) => `wa.steps.${n}`),
      ...["dta.fmt.csv"]];
    expect(need.filter((k) => !(k in en))).toEqual([]);
  });
  it("every kind of failure has its sentence", () => {
    expect(Object.values(FAILURE_KEY).filter((k) => !(k in en))).toEqual([]);
  });
});
