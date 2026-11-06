import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace: push, prefetch: () => undefined }), usePathname: () => "/app/tenants/T", useSearchParams: () => new URLSearchParams("demo=video") }));

import { appDict } from "@/i18n/app";
import { ANSWER_TE, ASKED_TE, REPLY_EN, REPLY_TE } from "@/lib/demo-video/fixtures";
import { BEATS } from "@/lib/demo-video/script";

import { NO_FRAME_DATA, type FrameData } from "../contract";
import { useFrameData } from "../frame-store";
import DemoVideo from "./DemoVideo";

const WORDS = appDict("en") as Record<string, string>;
const NOW = Date.parse("2026-11-05T01:30:00Z"); // 7:00 in India
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const LONG = { timeout: 5000 };

/** What the frame (the menu) is told while the story plays. */
function FrameProbe() {
  const f = useFrameData(NO_FRAME_DATA);
  return <output data-probe="" data-waiting={String(f.waiting)} data-live={String(f.live)} />;
}
const frameSeen = (): Pick<FrameData, "waiting" | "live"> => {
  const el = document.querySelector<HTMLElement>("[data-probe]")!;
  return { waiting: Number(el.dataset.waiting), live: el.dataset.live === "true" };
};
const stage = () => document.querySelector<HTMLElement>("[data-dv-stage]")!;
const step = () => Number(stage().dataset.dvStep);
const beat = () => stage().dataset.dvBeat;
const key = async (k: string) => act(async () => void fireEvent.keyDown(window, { key: k }));
/** Nothing on the screen calls it an example or a made-up demo (the practice call's own honest "simulated" words stay). */
const clean = () => {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(/\bexamples?\b/i);
  expect(text).not.toContain(WORDS["lf.demo"]);
  expect(text).not.toMatch(/\bDEMO\b/);
  expect(text).not.toMatch(/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/); // no raw word keys
};

async function draw() {
  await act(async () => {
    render(
      <>
        <DemoVideo words={WORDS} base={BASE} lang="en" now={NOW} frame={{ ...NO_FRAME_DATA, live: true, waiting: 40 }} />
        <FrameProbe />
      </>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe("the demo video: each step on the real screens, from fixtures", () => {
  it("plays the eight steps with the presenter's next key, clean of any example or demo label", async () => {
    await draw();
    // 1. Today, a calm morning
    expect(step()).toBe(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good morning, Ravi");
    expect(screen.getByText("Kalyani Textiles, Vijayawada")).toBeInTheDocument();
    clean();
    // the frame: the count on Today follows the story, and "Live now" stays off (it would read the workspace's real activity)
    expect(frameSeen().waiting).toBe(2);
    expect(frameSeen().live).toBe(false);

    // 2. a new WhatsApp lead: the reply the assistant drafted waits on top of Needs you
    await key("ArrowRight");
    expect(step()).toBe(2);
    const row = document.querySelector('[data-needs-row^="outbox_approval-"]')!;
    expect(row).toHaveTextContent("Reply to Lakshmi");
    expect(frameSeen().waiting).toBe(3);
    clean();

    // 3. the reply in Telugu, with its English, opens in place
    await key("ArrowRight");
    expect(step()).toBe(3);
    expect(screen.getByText(REPLY_TE)).toBeInTheDocument();
    expect(screen.getByText(REPLY_EN)).toBeInTheDocument();
    clean();

    // 4. the owner approves: the card leaves, the toast says it went, then the chat shows her message, the reply, and her answer
    await key("ArrowRight");
    await waitFor(() => expect(screen.getByText("Sent to Lakshmi.")).toBeInTheDocument(), LONG);
    expect(step()).toBe(4);
    await waitFor(() => expect(beat()).toBe("chat"), LONG);
    expect(screen.getByText(ASKED_TE)).toBeInTheDocument();
    expect(screen.getByText(REPLY_TE)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(ANSWER_TE)).toBeInTheDocument(), LONG);
    clean();

    // 5. the owner asks the Lead Finder: the question is typed into the box a letter at a time; the plan card; OK; the result card and the businesses found
    await key("ArrowRight");
    expect(step()).toBe(5);
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLInputElement).value.length).toBeGreaterThan(3), LONG);
    expect("find new boutiques in Jayanagar, Bengaluru".startsWith((screen.getByRole("textbox") as HTMLInputElement).value)).toBe(true);
    await key("ArrowRight"); // the rest of the question at once, then "Plan the search"
    expect(screen.getByRole("textbox")).toHaveValue("find new boutiques in Jayanagar, Bengaluru");
    await waitFor(() => expect(document.querySelector("[data-plan-card]")).not.toBeNull(), LONG);
    expect(beat()).toBe("plan");
    clean();
    await key("ArrowRight");
    await waitFor(() => expect(document.querySelector("[data-result-card]")).toHaveTextContent("Found 16 · 5 call-ready · 3 need you · 8 skipped"), LONG);
    expect(beat()).toBe("found");
    expect(screen.getByText("Mallige Silk Boutique")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); // the OK reads no page again
    clean();

    // 6. the practice call (simulated): it qualifies
    await key("ArrowRight");
    expect(step()).toBe(6);
    expect(beat()).toBe("call");
    await key("ArrowRight"); // unfolds "Practice call" (the step moves on from the click on it, which may land a moment later)
    await waitFor(() => expect(beat()).toBe("start"), LONG);
    await key("ArrowRight");
    await waitFor(() => expect(document.querySelector("[data-practice-result]")).not.toBeNull(), LONG);
    expect(document.querySelector('[data-outcome="qualified"]')).not.toBeNull();
    expect(screen.getByText(/Shall I send the quote on WhatsApp\?/)).toBeInTheDocument();
    clean();

    // 7. the draft quote at the catalogue's prices, made as a draft (nothing approved or sent)
    expect(step()).toBe(7);
    await waitFor(() => expect(document.querySelector("[data-draft-make]")).not.toBeNull(), LONG);
    await key("ArrowRight");
    await waitFor(() => expect(document.querySelector("[data-draft-made]")).not.toBeNull(), LONG);
    expect(beat()).toBe("made");
    clean();

    // 8. "Done while you slept", and the new draft quote waiting on Today
    await key("ArrowRight");
    expect(step()).toBe(8);
    await waitFor(() => expect(document.querySelector('[data-part="done"]')).toHaveTextContent("Replied to 7 customers on WhatsApp"), LONG);
    expect(screen.getByText("Mallige Silk Boutique, Bengaluru")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled(); // no link of the story ever navigated
    clean();
    // the end stays the end
    await key("ArrowRight");
    expect(beat()).toBe("done");
  }, 30_000);

  it("starts again at step 1 at once with R (or Home), whatever was done", async () => {
    await draw();
    await key("ArrowRight");
    await key("ArrowRight");
    expect(step()).toBe(3);
    await key("r");
    expect(step()).toBe(1);
    expect(document.querySelector('[data-needs-row^="outbox_approval-"]')).toBeNull();
    await key("ArrowRight");
    await key("Home");
    expect(step()).toBe(1);
  });

  it("holds every other button and link still, so a slip of the mouse never leaves the story", async () => {
    await draw();
    await key("ArrowRight");
    expect(beat()).toBe("lead");
    // the quick Approve of the row is not this beat's click, nor the link of another card
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-needs-row^="outbox_approval-"]')!).getByRole("button", { name: WORDS["today.act.approve"] }));
    const other = document.querySelector<HTMLElement>('[data-needs-row^="quote_approval-"] a')!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    other.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(beat()).toBe("lead");
    expect(screen.queryByText("Sent to Lakshmi.")).toBeNull();
    // the beat's own click works
    await act(async () => void fireEvent.click(document.querySelector<HTMLElement>('[data-needs-row^="outbox_approval-"] [title]')!));
    await waitFor(() => expect(beat()).toBe("reply"));
  });

  it("moves on with a click on the page in a beat that has nothing to press", async () => {
    await draw();
    await act(async () => void fireEvent.click(screen.getByRole("heading", { level: 1 })));
    expect(step()).toBe(2);
  });

  it("leaves the menu's links still too, and ignores the keys while a field has the keyboard", async () => {
    await draw();
    const outside = document.createElement("a");
    outside.href = "/app/tenants/T/leads";
    document.body.appendChild(outside);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    outside.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    outside.remove();
    const field = document.createElement("input");
    document.body.appendChild(field);
    await act(async () => void fireEvent.keyDown(field, { key: "ArrowRight" }));
    expect(step()).toBe(1);
    field.remove();
    // a key with Ctrl / Cmd is the browser's
    await act(async () => void fireEvent.keyDown(window, { key: "r", metaKey: true }));
    await act(async () => void fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true }));
    expect(step()).toBe(1);
  });

  it("has one beat per click of the script, eight steps in order", () => {
    expect(BEATS.map((b) => b.step)).toEqual([...BEATS.map((b) => b.step)].sort((a, b) => a - b));
    expect(new Set(BEATS.map((b) => b.step))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    for (const b of BEATS) if (b.target) expect(b.on).toBeDefined();
  });
});
