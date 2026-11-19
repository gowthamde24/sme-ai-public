vi.mock("./LazyMarkContacted", async () => ({ MarkContacted: (await import("./MarkContacted")).MarkContacted }));
vi.mock("./LazyResearcherCard", async () => ({ ResearcherCard: (await import("./ResearcherCard")).ResearcherCard }));

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { appDict } from "@/i18n/app";
import { parseAvailability, parseProspect } from "@/lib/api/lead-finder";
import { PROSPECT_CONTACTED, PROSPECT_MAYBE, PROSPECT_STRONG } from "@/lib/api/lead-finder-fixtures";
import { fitWord } from "@/lib/lead-finder/types";

import { FinderQuota } from "./FinderQuota";
import { ProspectCards, type CardActions } from "./ProspectCards";
import { ProspectList, type ListActions } from "./ProspectList";
import { ResearcherCard } from "./ResearcherCard";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(lf|apierr|jobs\.trust)\./.test(k)));
const BASE = "/app/tenants/t";
const strong = parseProspect(PROSPECT_STRONG);
const contacted = parseProspect(PROSPECT_CONTACTED);
const maybe = parseProspect(PROSPECT_MAYBE);
const mark = vi.fn(async () => ({ ok: true as const, data: contacted }));

describe("the fit", () => {
  it("80 and over is strong, 65 and over good, below that maybe", () => {
    expect([100, 86, 80, 79, 74, 65, 64, 58, 0].map(fitWord)).toEqual(["strong", "strong", "strong", "good", "good", "good", "maybe", "maybe", "maybe"]);
  });
});

describe("a Researcher card (mock 05)", () => {
  it("shows the ring with the number and the word, the name, the chip, why it fits and the talking points", () => {
    render(<ResearcherCard prospect={strong} words={words} base={BASE} mark={mark} />);
    const ring = screen.getByRole("img", { name: "Fit 86 out of 100" });
    expect(ring).toHaveAttribute("data-fit", "strong");
    expect(ring.textContent).toContain("86");
    expect(ring.textContent).toContain("fit");
    expect(screen.getByRole("heading", { name: "Sri Lakshmi Boutique" })).toBeInTheDocument();
    expect(screen.getByText("Strong fit")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Why it fits" })).toBeInTheDocument();
    expect(screen.getByText(/Sells silk sarees and dress material/)).toBeInTheDocument();
    const points = within(document.querySelector('[data-part="talking-points"]') as HTMLElement).getAllByRole("listitem");
    expect(points.map((li) => li.textContent)).toEqual(["Ask if they stock Pochampally ikat, which they do not list online", "Offer a sample set of 5 sarees to look at", "Mention you already supply 3 shops nearby"]);
  });
  it("a maybe has the amber ring and the word Maybe; no talking points means no such part", () => {
    render(<ResearcherCard prospect={{ ...maybe, talkingPoints: undefined }} words={words} base={BASE} mark={mark} />);
    expect(screen.getByRole("img", { name: "Fit 58 out of 100" })).toHaveAttribute("data-fit", "maybe");
    expect(screen.getByText("Maybe")).toBeInTheDocument();
    expect(document.querySelector('[data-part="talking-points"]')).toBeNull();
  });
  it("'Call from your phone' is the ONE full-width primary (a tel: link); 'Plan a visit' and 'Mark as contacted' sit side by side under it", () => {
    render(<ResearcherCard prospect={strong} words={words} base={BASE} mark={mark} />);
    const call = screen.getByRole("link", { name: "Call from your phone" });
    expect(call.getAttribute("href")).toMatch(/^tel:\+?\d+$/);
    expect(call.className).toContain("w-full");
    expect(call.className).toContain("bg-brand");
    const visit = screen.getByRole("link", { name: "Plan a visit" });
    const markBtn = screen.getByRole("button", { name: "Mark as contacted" });
    expect(visit.parentElement).toBe(markBtn.parentElement);
    expect(visit.parentElement?.className).toContain("@[26rem]:grid-cols-2"); // side by side where the card is wide enough, stacked on a phone (mock 05)
    expect(visit.className).not.toContain("bg-brand");
    expect(markBtn.className).not.toContain("bg-brand");
  });
  it("there is no AI call and no WhatsApp action for a prospect anywhere on the card", () => {
    render(<ResearcherCard prospect={strong} words={words} base={BASE} mark={mark} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/whatsapp/i);
    expect(screen.queryByRole("button", { name: /call/i })).toBeNull();
    expect(screen.queryByText(/assistant will call|let the assistant|AI call/i)).toBeNull();
    expect(document.querySelectorAll("a[href^='tel:']")).toHaveLength(1);
  });
  it("a business without a phone says so instead of offering a call", () => {
    render(<ResearcherCard prospect={{ ...strong, phone: null }} words={words} base={BASE} mark={mark} />);
    expect(screen.queryByRole("link", { name: "Call from your phone" })).toBeNull();
    expect(screen.getByText(/phone/i, { selector: '[data-part="prospect-no-phone"]' })).toBeInTheDocument();
  });
  it("Mark as contacted opens the form in place of the buttons, saves the day and the note, then shows the solid chip and Edit note", async () => {
    const m = vi.fn(async () => ({ ok: true as const, data: contacted }));
    render(<ResearcherCard prospect={strong} words={words} base={BASE} mark={m} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as contacted" }));
    expect(screen.queryByRole("link", { name: "Call from your phone" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: " Spoke to the owner. " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m).toHaveBeenCalledWith(strong.id, { daysAgo: 0, note: "Spoke to the owner." }));
    expect(await screen.findByText("Contacted · 19 Nov")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark as contacted" })).toBeNull();
    expect(screen.getByRole("link", { name: "Call from your phone" })).toBeInTheDocument();
  });
  it("an already contacted business shows who, when and the note and Edit note instead of the button", () => {
    render(<ResearcherCard prospect={contacted} words={words} base={BASE} mark={mark} />);
    expect(screen.getByText("Contacted · 19 Nov")).toBeInTheDocument();
    expect(screen.getByText("by Ramesh")).toBeInTheDocument();
    expect(screen.getByText("Spoke to the owner. Wants to see samples next week.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
  });
});

describe("the lists use the Researcher card only under JOBS", () => {
  const cardActions = { act: vi.fn(), quoteDraft: vi.fn(), makeQuoteDraft: vi.fn(), planLikeThis: vi.fn(), approve: vi.fn(), cancel: vi.fn(), mark } as unknown as CardActions;
  const langNames = { en: "English", te: "Telugu" };
  it("ProspectCards: JOBS draws the ring and the talking points; without JOBS there is no ring", () => {
    render(<ProspectCards items={[strong, contacted, maybe]} words={words} base={BASE} canPractice canSearch langNames={langNames} actions={cardActions} jobs />);
    expect(document.querySelectorAll('[data-part="fit-ring"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-part="talking-points"]')).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Call from your phone" })).toHaveLength(3);
    cleanup();
    render(<ProspectCards items={[strong]} words={words} base={BASE} canPractice canSearch langNames={langNames} actions={cardActions} />);
    expect(document.querySelector('[data-part="fit-ring"]')).toBeNull();
    expect(document.querySelector('[data-part="talking-points"]')).toBeNull();
  });
  it("ProspectList: the same", () => {
    const listActions = { act: vi.fn(), quoteDraft: vi.fn(), makeQuoteDraft: vi.fn(), mark } as unknown as ListActions;
    render(<ProspectList items={[strong]} words={words} base={BASE} canPractice langNames={langNames} actions={listActions} jobs />);
    expect(document.querySelector('[data-part="fit-ring"]')).not.toBeNull();
    cleanup();
    render(<ProspectList items={[strong]} words={words} base={BASE} canPractice langNames={langNames} actions={listActions} />);
    expect(document.querySelector('[data-part="fit-ring"]')).toBeNull();
  });
});

describe("the free-search line and Find shops now", () => {
  const avail = (left: number, per = 1) => parseAvailability({ access: left === 0 ? "limit_reached" : "available", source: "fixture", reason: "ok", searches_per_month: per, searches_left_this_month: left });
  it("JOBS: '1 free search a month · 1 left · last search 12 Nov', the chip '1 search left' and the button", () => {
    render(<FinderQuota words={words} availability={avail(1)} plansHref="/p" jobs lastSearchAt="2026-11-12T08:00:00Z" findHref="#finder-box" />);
    expect(screen.getByText("1 free search a month · 1 left · last search 12 Nov")).toBeInTheDocument();
    expect(screen.getByText("1 search left")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find shops now" })).toHaveAttribute("href", "#finder-box");
  });
  it("more searches a month, and no date when there was no search yet", () => {
    render(<FinderQuota words={words} availability={avail(2, 3)} plansHref="/p" jobs lastSearchAt={null} findHref="#finder-box" />);
    expect(screen.getByText("3 free searches a month · 2 left")).toBeInTheDocument();
    expect(screen.getByText("2 searches left")).toBeInTheDocument();
  });
  it("used up: the older note with the way to plans, and no 'Find shops now'", () => {
    render(<FinderQuota words={words} availability={avail(0)} plansHref="/p" jobs lastSearchAt="2026-11-12T08:00:00Z" findHref="#finder-box" />);
    expect(screen.queryByRole("link", { name: "Find shops now" })).toBeNull();
    expect(screen.getByRole("link", { name: "See plans" })).toBeInTheDocument();
  });
  it("without JOBS the line is the one it always was", () => {
    render(<FinderQuota words={words} availability={avail(1)} plansHref="/p" />);
    expect(screen.getByText("1 free search a month on every plan · 1 left this month")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Find shops now" })).toBeNull();
  });
});
