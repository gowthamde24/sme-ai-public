import { act, cleanup, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/app/tenants/T/quotes", search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.search) }));

import { parseAccess } from "@/lib/api/billing-access";
import { ADDRESSES } from "@/lib/site/business";

import { TodayView } from "../today/TodayView";
import { NOW, call, classic, fakeActions, outbox, t } from "../today/today-test-kit";
import type { TodayData } from "../today/types";
import { btnMain } from "../ui";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { ReadOnlyScope } from "./ReadOnlyScope";
import { keepsControls, switchOff, switchOn } from "./read-only-rules";

const WHY = `Read-only: this is switched off. To go on, write to ${ADDRESSES.billing}.`;
const words = { "ro.title": "This workspace is read-only", "ro.body": "Your trial ended without a payment.", "plan.readonly.until": "Your data is kept until {date} and then deleted. Days left: {n}.", "plan.readonly.go": "To go on, write to {email}." };

beforeEach(() => {
  nav.path = "/app/tenants/T/quotes";
  nav.search = "";
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = ""; // the switching tests write their page straight into the document
});

describe("what the billing access answer says (job DP)", () => {
  it("full access is not read-only; read-only carries the day it began, the day the data goes and the days left", () => {
    expect(parseAccess({ access: "full", read_only_since: null, delete_on: null, data_days_left: null })).toEqual({ readOnly: false });
    expect(parseAccess({ access: "read_only", read_only_since: "2026-10-20", delete_on: "2027-01-18", data_days_left: 85, can_resume: true })).toEqual({ readOnly: true, since: "2026-10-20", deleteOn: "2027-01-18", daysLeft: 85, canResume: true });
    expect(parseAccess({ access: "read_only" })).toEqual({ readOnly: true, since: null, deleteOn: null, daysLeft: null, canResume: false });
  });
  it("refuses anything else (never a guess)", () => {
    for (const bad of [null, "x", {}, { access: "paused" }, { access: 1 }]) expect(() => parseAccess(bad)).toThrow();
  });
});

describe("which screens keep their controls", () => {
  it("the plans, privacy, suppression and help screens, and the parts of Settings about the person or the data; not the other parts", () => {
    for (const [p, s] of [["/app/tenants/T/plans", null], ["/app/tenants/T/help/today", null], ["/app/tenants/T/privacy", null], ["/app/tenants/T/settings", "data"], ["/app/tenants/T/settings", "plan"], ["/app/tenants/T/settings", "privacy"], ["/app/tenants/T/settings", "security"], ["/app/tenants/T/settings", "language"]] as const) expect(keepsControls(p, s), `${p} ${s}`).toBe(true);
    for (const [p, s] of [["/app/tenants/T", null], ["/app/tenants/T/quotes", null], ["/app/tenants/T/settings", null], ["/app/tenants/T/settings", "business"], ["/app/tenants/T/settings", "members"], ["/app/tenants/T/settings", "assistant"], ["/app/tenants/T/outbox", null]] as const) expect(keepsControls(p, s), `${p} ${s}`).toBe(false);
  });
});

describe("switching controls off and on", () => {
  const page = () => {
    document.body.innerHTML = `<div id="main-content">
      <a class="write-ctl" href="/new">New quote</a><a href="/open">Open</a>
      <button class="write-ctl">Add</button><button type="submit">Save</button><button type="button">Show more</button>
      <article data-write><button type="button">Approve</button><input type="text" value="x"><a href="/see">See</a><input type="hidden" name="id" value="1"></article>
      <section data-read-ok><button class="write-ctl">Export</button><form data-write><button type="submit">Download</button></form></section>
    </div>`;
    return document.getElementById("main-content")!;
  };
  it("a main button, a submit button and everything inside a write region go off; a plain button, a link and the exports stay", () => {
    const root = page();
    expect(switchOff(root, WHY)).toBeGreaterThan(4);
    const off = (name: string) => (screen.getByText(name) as HTMLButtonElement).disabled;
    expect([off("Add"), off("Save"), off("Approve")]).toEqual([true, true, true]);
    expect((root.querySelector("article input[type=text]") as HTMLInputElement).disabled).toBe(true);
    expect((root.querySelector("input[type=hidden]") as HTMLInputElement).disabled).toBe(false);
    expect([off("Show more"), off("Export"), off("Download")]).toEqual([false, false, false]);
    expect(screen.getByText("New quote")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Open")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("See")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("Add")).toHaveAttribute("title", WHY);
  });
  it("putting it back leaves the page as it was", () => {
    const root = page();
    const before = root.innerHTML;
    switchOff(root, WHY);
    switchOn(root);
    expect(root.innerHTML).toBe(before);
  });
  it("the main button of the app carries the mark (so every screen's main button is covered without a change to it)", () => {
    expect(btnMain.split(" ")).toContain("write-ctl");
  });
});

describe("the notice", () => {
  const access = { readOnly: true as const, since: "2026-10-20", deleteOn: "2027-01-18", daysLeft: 85, canResume: false };
  it("says what is off, until when the data is kept and how to go on: write to the billing address", () => {
    render(<ReadOnlyBanner words={words} lang="en" access={access} />);
    const banner = document.querySelector("[data-readonly-banner]")!;
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("This workspace is read-only");
    expect(banner).toHaveTextContent("Days left: 85");
    expect(banner).toHaveTextContent(`write to ${ADDRESSES.billing}`);
    expect(banner).toHaveTextContent(/18 Jan 2027/);
  });
  it("draws the pay-again button when the page gives one", () => {
    render(<ReadOnlyBanner words={words} lang="en" access={{ ...access, deleteOn: null }} resume={<button>Pay again and continue</button>} />);
    expect(screen.getByRole("button", { name: "Pay again and continue" })).toBeInTheDocument();
  });
});

describe("the scope on a live screen", () => {
  const draw = () =>
    render(
      <div id="main-content">
        <ReadOnlyScope why={WHY} />
        <Link className="write-ctl" href="/new" data-testid="new">New quote</Link>
        <button className="write-ctl">Add</button>
      </div>,
    );
  it("switches off what is there, what appears later, and does not let a switched-off link be followed", async () => {
    draw();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    const late = document.createElement("button");
    late.type = "submit";
    late.textContent = "Late";
    await act(async () => {
      document.getElementById("main-content")!.appendChild(late);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(late.disabled).toBe(true);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByTestId("new").dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
  it("puts everything back on a screen that keeps its controls, and when it goes away", () => {
    const { rerender, unmount } = draw();
    nav.path = "/app/tenants/T/settings";
    nav.search = "section=data";
    rerender(
      <div id="main-content">
        <ReadOnlyScope why={WHY} />
        <Link className="write-ctl" href="/new" data-testid="new">New quote</Link>
        <button className="write-ctl">Add</button>
      </div>,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    nav.path = "/app/tenants/T/quotes";
    nav.search = "";
    rerender(
      <div id="main-content">
        <ReadOnlyScope why={WHY} />
        <Link className="write-ctl" href="/new" data-testid="new">New quote</Link>
        <button className="write-ctl">Add</button>
      </div>,
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    unmount();
  });
});

describe("on the main screens", () => {
  it("Today: the cards' buttons, the question line and the microphone are off; the help link, the links to other screens and the page stay", async () => {
    const d: TodayData = {
      cards: { waiting: 3, money_held_paise: 0, orders_open: 0 },
      needs: [outbox(), call(), classic()],
      recent: [],
      team: [{ agent: "main", state: "idle", job: "Answers.", last_event: null }],
      store: null,
      week: null,
      sending: null,
      digest: null,
    } as unknown as TodayData;
    await act(async () => {
      render(
        <div id="main-content">
          <ReadOnlyScope why={WHY} />
          <TodayView data={d} name="Asha" hour={9} now={NOW} base="/app/tenants/T" t={t} role="owner" actions={fakeActions()} help={<Link href="/app/tenants/T/help/today">Help for this screen</Link>} />
        </div>,
      );
    });
    const main = document.getElementById("main-content")!;
    const cardButtons = [...main.querySelectorAll<HTMLButtonElement>("article button")];
    expect(cardButtons.length).toBeGreaterThan(3);
    expect(cardButtons.every((b) => b.disabled)).toBe(true);
    expect((main.querySelector("#ask-input") as HTMLInputElement).disabled).toBe(true);
    expect(main.querySelector('[data-ask="live"] form button[type=submit]')).toBeDisabled();
    expect(screen.getByRole("link", { name: "Help for this screen" })).not.toHaveAttribute("aria-disabled");
    for (const a of main.querySelectorAll("article a")) expect(a).not.toHaveAttribute("aria-disabled");
    expect(main.querySelectorAll("[data-readonly-off]").length).toBeGreaterThan(5);
  });
});
