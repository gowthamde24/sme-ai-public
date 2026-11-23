import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { MOCK_JOBS } from "@/lib/jobs/mock";

import { JobsToday } from "./JobsToday";

vi.mock("./LazyJobRow", async () => ({ JobRow: (await import("./JobRow")).JobRow }));
vi.mock("./sheet/LazyFestival", () => ({ FestivalSuggestion: () => null }));
vi.mock("./sheet/NewJobButton", () => ({ NewJobButton: () => null }));

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));

describe("Today's 'Running now' in the open look (TODAY_OPEN)", () => {
  it("draws hairline rows with a bare category-coloured icon and no card, no icon tile", () => {
    const { container } = render(<JobsToday jobs={MOCK_JOBS} words={words} base="/app/tenants/t" actions={null} open />);
    const rows = container.querySelectorAll('[data-part="jobs-open"] [data-job]');
    expect(rows.length).toBe(MOCK_JOBS.length);
    for (const r of rows) expect(r.querySelector("svg[data-k]")).not.toBeNull();
    expect(container.querySelector('[data-part="jobs-open"]')?.className ?? "").not.toMatch(/rounded|border/);
    expect(container.innerHTML).not.toMatch(/bg-brand-bg/);
  });
  it("answer-calls is a call (blue), follow-ups a chat (green), visits violet, offers gold", () => {
    const { container } = render(<JobsToday jobs={MOCK_JOBS} words={words} base="/app/tenants/t" actions={null} open />);
    const k = (kind: string) => container.querySelector(`[data-job-kind="${kind}"] svg[data-k]`)?.getAttribute("data-k");
    expect(k("answer_calls")).toBe("call");
    expect(k("followups")).toBe("chat");
    expect(k("store_visits")).toBe("visit");
    expect(k("offers")).toBe("offer");
  });
  it("without the flag it is the old card of rows", () => {
    const { container } = render(<JobsToday jobs={MOCK_JOBS} words={words} base="/app/tenants/t" actions={null} />);
    expect(container.querySelector('[data-part="jobs-open"]')).toBeNull();
  });
});
