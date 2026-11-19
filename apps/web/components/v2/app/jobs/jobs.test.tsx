import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_JOBS } from "@/lib/jobs/mock";

import { JobRow } from "./JobRow";
import { JobsList } from "./JobsList";
import { JobsToday } from "./JobsToday";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const job = (kind: string) => MOCK_JOBS.find((j) => j.kind === kind)!;
const acts = (over = {}) => ({ setEnabled: vi.fn(async (id: string, enabled: boolean) => ({ ok: true as const, data: { id, enabled, status: enabled ? ("running" as const) : ("paused" as const) } })), ...over });

describe("a job row", () => {
  it("shows the plain name, the ONE result line from its code and numbers, and no chip for a job that is simply running", () => {
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={acts()} />);
    const row = document.querySelector('[data-job-kind="speed_to_lead"]') as HTMLElement;
    expect(within(row).getByText("Call every new enquiry right away")).toBeInTheDocument();
    expect(within(row).getByText("Today: called 6 new enquiries · 4 picked up · 2 store visits booked")).toBeInTheDocument();
    expect(row.querySelector(".jb-chip")).toBeNull();
    expect(within(row).getByRole("link")).toHaveAttribute("href", `${BASE}/jobs/${job("speed_to_lead").id}`);
  });
  it("a name the owner gave replaces the plain name; waiting, failed and done wear the solid chip and a failed job shows its fix", () => {
    render(
      <>
        <JobRow job={job("store_visits")} words={words} base={BASE} actions={acts()} />
        <JobRow job={job("offers")} words={words} base={BASE} actions={acts()} />
        <JobRow job={job("followups")} words={words} base={BASE} actions={acts()} />
      </>,
    );
    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(document.querySelector('[data-job-kind="store_visits"] .jb-chip')).toHaveAttribute("data-tone", "done");
    expect(document.querySelector('[data-job-kind="offers"] .jb-chip')).toHaveAttribute("data-tone", "wait");
    const failed = document.querySelector('[data-job-kind="followups"]') as HTMLElement;
    expect(failed.querySelector(".jb-chip")).toHaveAttribute("data-tone", "fail");
    expect(within(failed).getByText("Send template")).toBeInTheDocument();
  });
  it("the switch answers at once, calls the action once with the new state, and takes the API's answer", async () => {
    const a = acts();
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={a} />);
    const sw = screen.getByRole("switch", { name: "Call every new enquiry right away" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    await waitFor(() => expect(a.setEnabled).toHaveBeenCalledWith(job("speed_to_lead").id, false));
    expect(a.setEnabled).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });
  it("a refusal puts the switch back and says why; someone who may not switch sees it disabled", async () => {
    const a = acts({ setEnabled: vi.fn(async () => ({ ok: false as const, kind: "forbidden" as const, error: "You may not do this." })) });
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={a} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You may not do this.");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    cleanup();
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={null} />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});

describe("Today's Running now and the Jobs page", () => {
  it("Today: a heading with the count, a row per job and See all jobs; nothing at all with no jobs", () => {
    const { container, rerender } = render(<JobsToday jobs={MOCK_JOBS} words={words} base={BASE} actions={acts()} />);
    expect(screen.getByRole("heading", { name: "Running now" })).toBeInTheDocument();
    expect(container.querySelector("[data-count]")).toHaveAttribute("data-count", "7");
    expect(container.querySelectorAll("[data-job]")).toHaveLength(7);
    expect(screen.getByRole("link", { name: "See all jobs" })).toHaveAttribute("href", `${BASE}/jobs`);
    rerender(<JobsToday jobs={[]} words={words} base={BASE} actions={null} />);
    expect(container.querySelector('[data-part="jobs-today"]')).toBeNull();
  });
  it("the page: filter chips with counts (the open one marked), the rows of the filter, an empty note, Start a job", () => {
    const { container, rerender } = render(<JobsList jobs={MOCK_JOBS} filter="all" words={words} base={BASE} actions={acts()} />);
    expect(screen.getByRole("link", { name: "All 7" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Needs you 2" })).toHaveAttribute("href", `${BASE}/jobs?filter=needs_you`);
    expect(screen.getByRole("link", { name: "Start a job" })).toHaveAttribute("href", `${BASE}/jobs/new`);
    expect(container.querySelectorAll("[data-job]")).toHaveLength(7);
    rerender(<JobsList jobs={MOCK_JOBS} filter="paused" words={words} base={BASE} actions={acts()} />);
    expect(container.querySelectorAll("[data-job]")).toHaveLength(1);
    rerender(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={acts()} />);
    expect(container.querySelector('[data-empty="jobs"]')).not.toBeNull();
  });
});
