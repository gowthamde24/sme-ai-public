import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseResults } from "@/lib/api/campaigns";
import { RESULTS_JSON } from "@/lib/api/campaigns-fixtures";

import { WORDS } from "../materials/mat-test-kit";
import { ResultsView } from "./ResultsView";

describe("results", () => {
  it("adds sent, delivered and read the way a person counts them, and names why some did not go", () => {
    render(<ResultsView results={parseResults(RESULTS_JSON)} words={WORDS} />);
    const people = screen.getByText("People").closest("div")!;
    expect(within(people).getByText(String(RESULTS_JSON.recipients))).toBeInTheDocument();
    expect(screen.getByText("Why some did not go")).toBeInTheDocument();
    for (const code of Object.keys(RESULTS_JSON.by_reason)) expect(document.body.textContent).not.toContain(`camp.reason.${code}`);
  });
  it("a reason it has no sentence for is 'Another reason', never a raw code", () => {
    render(<ResultsView results={parseResults({ ...RESULTS_JSON, by_reason: { brand_new_reason: 2 } })} words={WORDS} />);
    expect(screen.getByText("Another reason")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("brand_new_reason");
  });
  it("says nothing has gone when nothing has", () => {
    render(<ResultsView results={parseResults({ ...RESULTS_JSON, by_state: {}, by_reason: {}, by_day: [], closed: {}, calls: {}, replied: 0, paid_after_reminder: { recipients: 0, amount_paise: 0 } })} words={WORDS} />);
    expect(screen.getByText("Nothing has gone yet.")).toBeInTheDocument();
  });
});
