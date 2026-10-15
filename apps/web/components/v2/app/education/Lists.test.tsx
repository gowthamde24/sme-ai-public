import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseAdmissionList, parseFeePlan, parseFeePlanList, parsePending, parseProgrammes, parseStudentList } from "@/lib/api/education";
import * as F from "@/lib/api/education-fixtures";
import { parseReport } from "@/lib/api/reports";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { AdmissionsBoard } from "./AdmissionsBoard";
import { FeePlanDetail, FeePlansView } from "./FeePlansView";
import { FeesDashboard } from "./FeesDashboard";
import { PendingList } from "./PendingList";
import { StudentsView } from "./StudentsView";

const programmes = parseProgrammes(F.PROGRAMMES_JSON);
const noop = async () => ({ ok: true as const, posted: 0, totalPaise: 0 });

describe("the students list", () => {
  const props = { base: BASE, words: WORDS, programmes, programme: null, status: null as null | "active" | "left", more: null, saved: false, imported: false };
  it("names each student by the first name or initials, with class, section and admission number; an erased one has no name", () => {
    render(<StudentsView {...props} role="owner" students={[...parseStudentList(F.STUDENT_LIST_JSON).items, ...parseStudentList({ items: [F.STUDENT_ERASED_JSON], next_cursor: null }).items]} />);
    expect(screen.getByRole("link", { name: /Asha \(synthetic\)/ })).toHaveAttribute("href", `${BASE}/students/${F.STUDENT}`);
    expect(screen.getByText(/Class 5 \(synthetic\) · A · No\. A-1001/)).toBeInTheDocument();
    expect(screen.getAllByText("Erased").length).toBeGreaterThan(0);
  });
  it("Owner and Admin can add and import; Sales cannot", () => {
    const { rerender } = render(<StudentsView {...props} role="owner" students={[]} />);
    expect(screen.getAllByRole("link", { name: "Import a file" }).length).toBeGreaterThan(0);
    rerender(<StudentsView {...props} role="sales" students={[]} />);
    expect(screen.queryByRole("link", { name: "Add a student" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Import a file" })).toBeNull();
  });
  it("says when nothing matches the filter, and when it could not load", () => {
    const { rerender } = render(<StudentsView {...props} role="owner" students={[]} status="left" />);
    expect(screen.getByText("No students match.")).toBeInTheDocument();
    rerender(<StudentsView {...props} role="owner" students={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this");
  });
});

describe("the admissions board", () => {
  it("has a column for every stage with its count, and no child anywhere", () => {
    render(<AdmissionsBoard base={BASE} words={WORDS} role="sales" admissions={parseAdmissionList(F.ADMISSIONS_JSON).items} programmes={programmes} programme={null} source={null} more={false} saved={false} />);
    for (const stage of ["Enquiry", "Campus visit", "Application", "Admitted", "Lost"]) expect(screen.getByRole("heading", { name: new RegExp(`^${stage}`) })).toBeInTheDocument();
    expect(screen.getByText(/Visit on 2026-10-18/)).toBeInTheDocument();
    expect(screen.getByText("Fees")).toBeInTheDocument();
  });
});

describe("pending fees", () => {
  it("the word is pending, never anything harsher", () => {
    render(<PendingList base={BASE} words={WORDS} rows={parsePending(F.PENDING_JSON).items} programmes={programmes} programme={null} more={`${BASE}/fees/pending?after=c`} />);
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/defaulter|overdue list|bad debt/);
    expect(screen.getByRole("heading", { name: "Fees pending" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Kiran \(synthetic\)/ })[0]).toHaveAttribute("href", `${BASE}/fees/students/${F.STUDENT2}`);
    expect(screen.getByText("₹9,000.00")).toBeInTheDocument();
  });
});

describe("fee plans", () => {
  it("lists plans with the total and how many hold each", () => {
    render(<FeePlansView base={BASE} words={WORDS} role="owner" plans={parseFeePlanList(F.PLAN_LIST_JSON)} programmes={programmes} />);
    expect(screen.getByRole("link", { name: /Class 5 fees 2026-27/ })).toHaveTextContent("₹62,000.00");
    expect(screen.getByText(/31 students hold it/)).toBeInTheDocument();
  });
  it("a plan that is held cannot be changed, only copied", () => {
    render(<FeePlanDetail base={BASE} words={WORDS} role="owner" plan={parseFeePlan(F.PLAN_DETAIL_JSON)} programme={programmes[0]} saved={false} />);
    expect(screen.queryByRole("link", { name: "Change" })).toBeNull();
    expect(screen.getByRole("link", { name: "Make a copy as a new plan" })).toHaveAttribute("href", `${BASE}/fees/plans/new?from=${F.PLAN}`);
    expect(screen.getByText(/Students hold this plan, so it cannot change/)).toBeInTheDocument();
  });
  it("a plan nobody holds can be changed", () => {
    render(<FeePlanDetail base={BASE} words={WORDS} role="admin" plan={parseFeePlan({ ...F.PLAN_DETAIL_JSON, assigned: 0 })} programme={programmes[0]} saved />);
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute("href", `${BASE}/fees/plans/${F.PLAN}/edit`);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
});

describe("the fees dashboard", () => {
  const collection = parseReport(F.COLLECTION_REPORT_JSON);
  const today = parseReport(F.TODAY_REPORT_JSON);
  it("shows the report's own numbers in words of ours", () => {
    render(<FeesDashboard base={BASE} words={WORDS} role="owner" collection={collection} today={today} plans={2} lateFees={null} postLateFees={noop} />);
    expect(document.querySelector("[data-kpi=due_paise]")).toHaveTextContent("₹5,80,000.00");
    expect(document.querySelector("[data-kpi=collection_pct]")).toHaveTextContent("87.2%");
    expect(screen.getByText("₹37,000.00")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/_paise|_pct/);
    expect(document.body.textContent?.toLowerCase()).not.toContain("defaulter");
  });
  it("a school with no plan is pointed at making one", () => {
    render(<FeesDashboard base={BASE} words={WORDS} role="owner" collection={collection} today={null} plans={0} lateFees={null} postLateFees={noop} />);
    expect(screen.getByText("No fee plan yet")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Make a fee plan" }).length).toBeGreaterThan(0);
  });
  it("a report that could not be read says so instead of showing nothing", () => {
    render(<FeesDashboard base={BASE} words={WORDS} role="sales" collection={null} today={null} plans={null} lateFees={null} postLateFees={noop} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this");
    expect(screen.queryByRole("link", { name: "Send a reminder campaign" })).toBeNull();
  });
});
