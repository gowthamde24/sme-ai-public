import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COLLECTION_REPORT_JSON, FUNNEL_REPORT_JSON } from "@/lib/api/education-fixtures";
import { parseReport } from "@/lib/api/reports";

import { WORDS } from "../materials/mat-test-kit";
import { KpiCards, ReportTableView, SeriesBars, formatValue } from "./ReportParts";

describe("drawing a figure by its type", () => {
  it.each([[1250000, "paise", "₹12,500.00"], [87.2, "percent", "87.2%"], [90, "percent", "90%"], [31, "count", "31"], [1234567, "count", "12,34,567"], [12.5, "count", "12.50"], [null, "percent", "—"], [null, "paise", "—"]] as const)("%s as %s is %s", (value, unit, want) => {
    expect(formatValue(value, unit)).toBe(want);
  });
});

describe("a report", () => {
  it("shows figures with words, never a raw key", () => {
    render(<KpiCards kpis={parseReport(COLLECTION_REPORT_JSON).kpis} words={WORDS} />);
    expect(screen.getByText("Fallen due")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/_paise|_pct|students_pending/);
  });
  it("only the figures asked for", () => {
    render(<KpiCards kpis={parseReport(COLLECTION_REPORT_JSON).kpis} words={WORDS} only={["collection_pct"]} />);
    expect(screen.getAllByRole("definition")).toHaveLength(1);
  });
  it("a table draws each column by its type and puts the words of a code in the person's language", () => {
    render(<ReportTableView table={parseReport(FUNNEL_REPORT_JSON).tables[0]} words={WORDS} id="t" />);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Walk-in")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Where from" })).toBeInTheDocument();
  });
  it("a code with no words of the report's own falls back on the unit, status and method words other screens already have, and then on a plain name", () => {
    const table = { key: "t", columns: [{ key: "status", type: "text" as const }, { key: "unit", type: "text" as const }, { key: "bucket", type: "text" as const }], rows: [["on_the_way", "sq_ft", "d31_60"], ["a_brand_new_one", "kg", "Class 5"]] };
    render(<ReportTableView table={table} words={WORDS} id="t" />);
    expect(screen.getByText("On the way")).toBeInTheDocument();
    expect(screen.getByText("sq ft")).toBeInTheDocument();
    expect(screen.getByText("31 to 60 days late")).toBeInTheDocument();
    expect(screen.getByText("a brand new one")).toBeInTheDocument();
    expect(screen.getByText("Class 5")).toBeInTheDocument();
  });
  it("a table with no rows says so", () => {
    render(<ReportTableView table={{ key: "by_method", columns: [{ key: "method", type: "text" }], rows: [] }} words={WORDS} id="t" />);
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument();
  });
  it("a key with no words is drawn as a plain name, never with underscores", () => {
    render(<KpiCards kpis={[{ key: "brand_new_figure", value: 3, unit: "count" }]} words={WORDS} />);
    expect(screen.getByText("Brand new figure")).toBeInTheDocument();
  });
  it("a series draws one bar per day with the day's number", () => {
    render(<SeriesBars series={parseReport(COLLECTION_REPORT_JSON).series[0]} words={WORDS} unit="paise" id="s" />);
    expect(screen.getByText("2026-10-12")).toBeInTheDocument();
    expect(screen.getByText("₹25,000.00")).toBeInTheDocument();
  });
});
