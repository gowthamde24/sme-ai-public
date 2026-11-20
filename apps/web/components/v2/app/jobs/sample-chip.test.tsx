import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./LazySearchPlan", async () => ({ SearchPlan: (await import("./SearchPlan")).SearchPlan }));

import { appDict } from "@/i18n/app";
import { parseNewJobSheet } from "@/lib/api/job-templates";
import { festivalHint } from "@/lib/jobs/festival";
import { mockPlan, mockStartPlan } from "@/lib/jobs/plan-mock";
import type { PlanInput } from "@/lib/jobs/plan";
import { wireNewJobSheet } from "@/lib/jobs/template-fixtures";
import type { SheetLoad } from "@/lib/jobs/templates";

import { FestivalSuggestion } from "./sheet/FestivalSuggestion";
import NewJobSheet from "./sheet/NewJobSheet";
import type { SheetActions } from "./sheet/types";
import { PlanCard, type PlanCardState } from "./PlanCard";
import { SampleChip } from "./SampleChip";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("jobs.")));
const BASE = "/app/tenants/t";
const IDLE: PlanCardState = { starting: false, testing: false, swapping: false, searching: false, note: null, error: null, waiting: null, quiet: false };
const acts = (): SheetActions => ({
  plan: vi.fn(async (input: PlanInput) => ({ ok: true as const, data: mockPlan(input) })),
  start: vi.fn(async (planId: string) => ({ ok: true as const, data: mockStartPlan(planId) })),
  test: vi.fn(async (_id: string, channel) => ({ ok: true as const, data: { channel, mock: true, minutesUsed: 0 } })),
  load: vi.fn(async () => ({ ok: false as const, error: "x" })),
});

describe("the small Sample chip on a part drawn from the sample data (staging preview, my business)", () => {
  it("is the word Sample, with the plain sentence when asked", () => {
    const { rerender } = render(<SampleChip words={words} />);
    expect(screen.getByText("Sample")).toBeInTheDocument();
    expect(screen.queryByText(/not ready for your business yet/)).toBeNull();
    rerender(<SampleChip words={words} note />);
    expect(screen.getByText("Sample data: this part is not ready for your business yet.")).toBeInTheDocument();
  });
  it("the plan card, the New job sheet and the festival suggestion wear it only when their data is sample", () => {
    const plan = mockPlan({ kind: "speed_to_lead" });
    const card = (p: typeof plan) => <PlanCard plan={p} words={words} base={BASE} state={IDLE} onStart={vi.fn()} onSwap={vi.fn()} onChange={vi.fn()} onTest={vi.fn()} />;
    const { unmount } = render(card(plan));
    expect(screen.queryByText("Sample")).toBeNull();
    unmount();
    render(card({ ...plan, sample: true }));
    expect(screen.getByText("Sample")).toBeInTheDocument();
    cleanup();

    const data = parseNewJobSheet(wireNewJobSheet());
    const load = (sample: boolean): SheetLoad => ({ data: sample ? { ...data, sample: true } : data, lang: "en", business: "Neelambari Silks", assistant: "Asha" });
    const { unmount: u2 } = render(<NewJobSheet words={words} base={BASE} actions={acts()} onClose={vi.fn()} initial={load(false)} />);
    expect(document.querySelector('[data-part="sample-ideas"]')).toBeNull();
    u2();
    render(<NewJobSheet words={words} base={BASE} actions={acts()} onClose={vi.fn()} initial={load(true)} />);
    expect(document.querySelector('[data-part="sample-ideas"]')).toHaveTextContent("Sample");
    cleanup();

    const hint = festivalHint([{ season: "diwali", name: { en: "Diwali" }, date: "2026-12-03", sample: true }], "en", new Date("2026-11-19T10:00:00"))!;
    expect(hint.sample).toBe(true);
    render(<FestivalSuggestion festival={hint} words={words} base={BASE} actions={acts()} />);
    expect(document.querySelector('[data-part="festival-suggestion"]')).toHaveTextContent("Sample");
    cleanup();
    const plain = festivalHint([{ season: "diwali", name: { en: "Diwali" }, date: "2026-12-03" }], "en", new Date("2026-11-19T10:00:00"))!;
    expect(plain.sample).toBeUndefined();
    render(<FestivalSuggestion festival={plain} words={words} base={BASE} actions={acts()} />);
    expect(document.querySelector('[data-part="festival-suggestion"]')).not.toHaveTextContent("Sample");
  });
});
