import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = { pathname: "/app/tenants/11111111-1111-4111-8111-111111111111" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => undefined }) }));

import { LiveNow, lineOf } from "./LiveNow";
import type { Membership } from "../use-workspace";
import { groupActivity } from "@/lib/activity/types";

const T = "11111111-1111-4111-8111-111111111111";
const memberships: Membership[] = [{ id: T, name: "Acme", role: "owner" } as Membership];
const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
let answer: unknown;
const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  answer = { items: [], pollAfterS: 5 };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

describe("Live now: the words of a line", () => {
  const rows = groupActivity([
    { type: "call", who: "Ramesh", elapsedS: 134, target: { kind: "task", id: id(1) } },
    { type: "whatsapp_reply", who: "A", elapsedS: 5, target: { kind: "conversation", id: id(2) } },
    { type: "follow_up", who: "B", elapsedS: 9, target: { kind: "conversation", id: id(3) } },
    { type: "lead_read", who: null, elapsedS: 1, target: { kind: "lead", id: id(4) } },
    { type: "quote_draft", who: "C", elapsedS: 2, target: { kind: "quote", id: id(5) } },
  ]);
  it("says what the assistant is doing, the call with its timer, the chats and leads counted", () => {
    expect(rows.map((r) => r.key)).toEqual(["call", "chats", "quote", "leads"]); // priority order
    expect(rows.map((r) => lineOf(r, r.elapsedS))).toEqual(["On a call with Ramesh · 2:14", "Replying on WhatsApp · 2 chats", "Drafting a quote", "Reading a new lead"]);
  });
  it("a tap opens the one thing it is about, else the list", () => {
    const base = `/app/tenants/${T}`;
    expect(rows.map((r) => r.href(base))).toEqual([`${base}/tasks/${id(1)}`, `${base}/chats`, `${base}/quotes/${id(5)}`, `${base}/leads/${id(4)}`]);
  });
  it("no name (a Viewer) and several calls still read plainly", () => {
    expect(lineOf(groupActivity([{ type: "call", who: null, elapsedS: 65, target: null }])[0], 65)).toBe("On a call · 1:05");
    expect(lineOf(groupActivity([{ type: "call", who: "A", elapsedS: 5, target: null }, { type: "call", who: "B", elapsedS: 5, target: null }])[0], 5)).toBe("On 2 calls");
  });
});

describe("Live now: the strip", () => {
  it("is not asked and not drawn when it is switched off", async () => {
    render(<LiveNow memberships={memberships} enabled={false} variant="side" />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-live]")).toBeNull();
  });
  it("draws nothing before the first answer (no empty box), then 'All caught up' when idle", async () => {
    render(<LiveNow memberships={memberships} enabled variant="side" />);
    expect(document.querySelector("[data-live]")).toBeNull();
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(`/app/tenants/${T}/activity`, expect.objectContaining({ cache: "no-store" }));
    expect(screen.getByText("All caught up")).toBeInTheDocument();
  });
  it("lists the work as links in the menu; the phone's line shows the first and '+n more'", async () => {
    answer = { items: [{ type: "call", who: "Ramesh", elapsed_s: 134, target: { kind: "task", id: id(1) } }, { type: "whatsapp_reply", who: "Anitha", elapsed_s: 3, target: { kind: "conversation", id: id(2) } }], poll_after_s: 5 };
    render(
      <>
        <LiveNow memberships={memberships} enabled variant="side" />
        <LiveNow memberships={memberships} enabled variant="line" />
      </>,
    );
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1); // one poll for both parts
    const side = document.querySelector('[data-live="side"]') as HTMLElement;
    expect(side.querySelectorAll("a")).toHaveLength(2);
    expect(side.querySelector("a")).toHaveAttribute("href", `/app/tenants/${T}/tasks/${id(1)}`);
    const line = document.querySelector('[data-live="line"]') as HTMLElement;
    expect(line).toHaveTextContent("On a call with Ramesh · 2:14");
    expect(line).toHaveTextContent("+1 more");
    expect(line.className).toContain("md:hidden");
  });
  it("keeps the last line through a failed read, and stops for good on a rejected session", async () => {
    answer = { items: [{ type: "lead_read", who: null, elapsed_s: 1, target: null }, { type: "lead_read", who: null, elapsed_s: 2, target: null }] };
    render(<LiveNow memberships={memberships} enabled variant="side" />);
    await settle();
    expect(screen.getByText("Reading 2 new leads")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 503 }));
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(screen.getByText("Reading 2 new leads")).toBeInTheDocument();
  });
});
