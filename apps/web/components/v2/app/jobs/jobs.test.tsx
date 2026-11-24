import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { parseJob } from "@/lib/api/jobs-parse";
import { WIRE_JOB_VARIANTS } from "@/lib/jobs/fixtures";
import { MOCK_JOBS } from "@/lib/jobs/mock";
import { jobState } from "@/lib/jobs/types";

import { JobRow } from "./JobRow";
import { JobsList } from "./JobsList";
import { JobsToday } from "./JobsToday";

vi.mock("./LazyJobRow", async () => ({ JobRow: (await import("./JobRow")).JobRow }));

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const job = (kind: string) => MOCK_JOBS.find((j) => j.kind === kind)!;
const acts = (over = {}) => ({ setEnabled: vi.fn(async (id: string, enabled: boolean) => ({ ok: true as const, data: { id, enabled, status: enabled ? ("running" as const) : ("paused" as const) } })), ...over });

describe("a job row", () => {
  it("its link stacks the name, the result line and the chips in a column (the shared `main a` tap-target rule would make them a row: staging 20 Nov)", () => {
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={acts()} />);
    const link = document.querySelector('[data-job-kind="speed_to_lead"] a') as HTMLElement;
    expect(link.className).toMatch(/\bflex-col\b/);
  });
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
  it("every result code of the contract has its sentence, in the contract's param names; dates are formatted by the web; an unknown code gets the generic line", () => {
    const variants = WIRE_JOB_VARIANTS.map(parseJob);
    const line = (j: (typeof variants)[number]) => {
      const { container } = render(<JobRow job={j} words={words} base={BASE} actions={null} />);
      const text = (container.querySelector("a > span:nth-of-type(2)") as HTMLElement).textContent;
      cleanup();
      return text;
    };
    const byCode = Object.fromEntries(variants.map((j) => [j.result.code + (j.result.params.last_search_at === undefined && j.result.code === "search_left" ? ".never" : ""), line(j)]));
    expect(byCode.not_sent_window).toBe("3 messages wait until 9 am: quiet hours");
    expect(byCode.needs_approval).toBe("2 things wait for your OK");
    expect(byCode.minutes_used).toBe("Your free minutes are used up");
    expect(byCode.no_whatsapp).toBe("WhatsApp is not connected yet");
    expect(byCode.no_number).toBe("There is no phone number yet");
    expect(byCode["search_left.never"]).toBe("1 of 1 free search left this month · no search yet");
    expect(byCode.a_code_the_web_has_no_words_for).toBe("Working on it. Open the job to see more.");
    expect(line(job("answer_calls"))).toBe("Today: answered 3 calls · 1 missed · 2 messages sent");
    expect(line(job("store_visits"))).toBe("Done today: 3 reminders sent · 2 confirmed");
    expect(line(job("researcher"))).toBe("1 of 1 free search left this month · last search 12 Nov");
    expect(byCode.paused_on).toBe("Paused on 14 Nov");
    expect(line(job("followups"))).toBe("2 messages need a template to go out");
    expect(line(job("offers"))).toBe("Ready to send to 38 customers");
  });
  it("a job the plan or the setup blocks wears a short note: a phone number, WhatsApp, free minutes or billing; a job with no gate has none", () => {
    const notes: Record<string, string> = { billing_blocked: "Billing needs a look", no_number: "Needs a phone number first", no_whatsapp: "Connect WhatsApp first", minutes_used: "Free minutes used" };
    for (const j of WIRE_JOB_VARIANTS.map(parseJob).filter((v) => v.planGate)) {
      const { container } = render(<JobRow job={j} words={words} base={BASE} actions={null} />);
      expect(container.querySelector("[data-part='job-gate']")).toHaveTextContent(notes[j.planGate!]);
      cleanup();
    }
    // every gate of the closed list is in the variants (the demo shop itself has none blocked)
    expect(WIRE_JOB_VARIANTS.map(parseJob).flatMap((j) => (j.planGate ? [j.planGate] : [])).sort()).toEqual(Object.keys(notes).sort());
    render(<JobRow job={job("speed_to_lead")} words={words} base={BASE} actions={null} />);
    expect(document.querySelector("[data-part='job-gate']")).toBeNull();
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
    // the count is the jobs that really run now, not the number of job types (owner, 29 Nov)
    const runningNow = MOCK_JOBS.filter((j) => jobState(j) === "running").length;
    expect(container.querySelector("[data-count]")).toHaveAttribute("data-count", String(runningNow));
    expect(container.querySelectorAll("[data-job]")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "See all jobs" })).toHaveAttribute("href", `${BASE}/jobs`);
    rerender(<JobsToday jobs={[]} words={words} base={BASE} actions={null} />);
    expect(container.querySelector('[data-part="jobs-today"]')).toBeNull();
  });
  it("the page: filter chips with counts (the open one marked), the rows of the filter, an empty note, Start a job", () => {
    const { container, rerender } = render(<JobsList jobs={MOCK_JOBS} filter="all" words={words} base={BASE} actions={acts()} />);
    expect(screen.getByRole("link", { name: "All 6" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Needs you 2" })).toHaveAttribute("href", `${BASE}/jobs?filter=needs_you`);
    expect(screen.getByRole("link", { name: "New job" })).toHaveAttribute("href", `${BASE}/jobs/new`);
    expect(container.querySelectorAll("[data-job]")).toHaveLength(6);
    // the six of the demo are all on; a paused job (a variant) is the one Paused shows
    const paused = parseJob(WIRE_JOB_VARIANTS.find((j) => (j.result as { code: string }).code === "paused_on")!);
    rerender(<JobsList jobs={[...MOCK_JOBS, paused]} filter="paused" words={words} base={BASE} actions={acts()} />);
    expect(container.querySelectorAll("[data-job]")).toHaveLength(1);
    rerender(<JobsList jobs={[]} filter="all" words={words} base={BASE} actions={acts()} />);
    expect(container.querySelector('[data-empty="jobs"]')).not.toBeNull();
  });
});
