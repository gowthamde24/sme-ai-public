import type { CatalogueOut, ReportOut } from "@contracts/reports";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, list, oneOf, rec, str, word } from "./shape";

/**
 * The reports of every pack in ONE shape (job CV, on the API of ADR 0088; read by the screens of jobs CS and CU): figures (kpis), typed tables and series by day. Every figure is a sum or a count of entries a person made.
 * Server side only, with the signed-in user's own token. A table cell is a text, a number or nothing; its type says how to draw it (a count, rupees, a percent). Nothing in a report names a child.
 */
export const KPI_UNITS = ["paise", "count", "percent", "seconds"] as const;
export const COLUMN_TYPES = ["text", "count", "paise", "percent"] as const;
export type Cell = string | number | null;
export type ReportKpi = ReportOut["kpis"][number];
export type ReportTable = Omit<ReportOut["tables"][number], "rows"> & { rows: Cell[][] };
export type Report = Omit<ReportOut, "tables"> & { tables: ReportTable[] };

const day = (v: unknown, what: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad(what));
const MAX_ROWS = 500;
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(what));

function cell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length <= 200 ? v : bad("cell");
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return bad("cell");
}

export function parseReport(json: unknown): Report {
  const r = rec(json, "report");
  const tables: ReportTable[] = list(r.tables, "tables", 12).map((t) => {
    const x = rec(t, "table");
    const columns = list(x.columns, "columns", 12).map((c) => {
      const y = rec(c, "column");
      return { key: word(y.key, "column key"), type: oneOf(y.type, COLUMN_TYPES, "column type") };
    });
    const rows = list(x.rows, "rows", MAX_ROWS).map((row) => {
      const cells = list(row, "row", 12).map(cell);
      if (cells.length !== columns.length) bad("row width");
      return cells;
    });
    return { key: word(x.key, "table key"), columns, rows };
  });
  return {
    report: word(r.report, "report", 60),
    as_of: day(r.as_of, "as_of"),
    from: day(r.from, "from"),
    to: day(r.to, "to"),
    kpis: list(r.kpis, "kpis", 24).map((k) => {
      const y = rec(k, "kpi");
      return { key: word(y.key, "kpi key"), value: y.value === null || y.value === undefined ? null : num(y.value, "kpi value"), unit: oneOf(y.unit, KPI_UNITS, "kpi unit") };
    }),
    tables,
    series: list(r.series, "series", 8).map((s) => {
      const y = rec(s, "series");
      return { key: word(y.key, "series key"), points: list(y.points, "points", 400).map((p) => { const z = rec(p, "point"); return { day: day(z.day, "day"), value: num(z.value, "value") }; }) };
    }),
  };
}

export function parseCatalogue(json: unknown): CatalogueOut {
  const r = rec(json, "catalogue");
  return {
    items: list(r.items, "items", 60).map((i) => {
      const x = rec(i, "catalogue item");
      return {
        code: word(x.code, "code", 60),
        title_key: str(x.title_key, "title_key", 80),
        window: oneOf(x.window, ["range", "day", "week"] as const, "window"),
        modules: list(x.modules, "modules", 12).map((m) => word(m, "module")),
      };
    }),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const path = (tenantId: string, tail: string) => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("id");
  return `/v1/tenants/${tenantId}/reports/${tail}`;
};

/** `GET /reports/catalogue`: the reports this business may run for this person (each needs the modules it names). */
export async function getReportCatalogue(accessToken: string, tenantId: string) {
  return parseCatalogue(await apiRequest(path(tenantId, "catalogue"), accessToken));
}

/** `GET /reports/run/{code}?from=&to=`: India days. A range report defaults to the last 30 days (a school's collection to the start of the academic year); a day report takes `to`. */
export async function runReport(accessToken: string, tenantId: string, code: string, opts: { from?: string; to?: string } = {}) {
  if (!/^[a-z]+\.[a-z_]+$/.test(code) || code.length > 60) throw new ApiContractError("code");
  const q = new URLSearchParams();
  for (const [k, v] of [["from", opts.from], ["to", opts.to]] as const) {
    if (v === undefined) continue;
    if (!DAY.test(v)) throw new ApiContractError("date");
    q.set(k, v);
  }
  return parseReport(await apiRequest(path(tenantId, `run/${code}${q.size > 0 ? `?${q.toString()}` : ""}`), accessToken));
}
