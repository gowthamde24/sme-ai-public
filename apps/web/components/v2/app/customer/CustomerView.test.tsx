import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { asFilter, businessName, customerStatus, customerWants, mainAction, rowHeading, sourceWords, timelineHref, waitingQuote } from "@/app/app/tenants/[tenantId]/customers/[leadId]/customer-logic";
import { wordsFor } from "@/i18n/app-words";
import { parseCustomerHead, parseTimeline, type TimelineItem } from "@/lib/api/customer-timeline";
import { parseProfile } from "@/lib/lead-desk/profile";

import { CustomerView, type CustomerViewProps } from "./CustomerView";

/** app v4 part 3: one page per customer. The contract readers, the plain-words parts and the view. */
const W = wordsFor("en", ["cust.v4.", "ld.source."]);
const BASE = "/app/tenants/11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const Q = "33333333-3333-4333-8333-333333333333";
const O = "44444444-4444-4444-8444-444444444444";
const NOW = Date.parse("2026-11-06T12:00:00Z");
const item = (kind: TimelineItem["kind"], at: string, over: Partial<TimelineItem> = {}): TimelineItem => ({ kind, at, text: `${kind} text`, target: { type: kind === "quote" ? "quote" : kind, id: Q }, detail: {}, ...over });

afterEach(cleanup);

describe("customer timeline contract", () => {
  it("keeps the rows that keep the contract and leaves the rest out", () => {
    const page = parseTimeline({
      items: [
        { kind: "call", at: "2026-11-06T10:00:00Z", text: "Wants a red Kanchi silk", target: { type: "phone_call", id: "c1" }, detail: { duration_s: 126, recorded: false, nested: { x: 1 } } },
        { kind: "telepathy", at: "2026-11-06T09:00:00Z", text: "?", target: { type: "x", id: "y" } },
        { kind: "quote", at: "not a time", text: "Quote 1", target: { type: "quote", id: Q } },
        { kind: "order", at: "2026-11-05T09:00:00Z", text: "x".repeat(300), target: { type: "order", id: O }, detail: null },
      ],
      next_before: "2026-11-05T09:00:00Z",
    });
    expect(page.items.map((i) => i.kind)).toEqual(["call", "order"]);
    expect(page.items[0].detail).toEqual({ duration_s: 126, recorded: false });
    expect(page.items[1].text).toHaveLength(200);
    expect(page.nextBefore).toBe("2026-11-05T09:00:00Z");
    expect(parseTimeline({ items: [], next_before: null }).nextBefore).toBeNull();
    expect(() => parseTimeline({ rows: [] })).toThrow();
  });

  it("reads the header from one lead read: the shown name, the profile's source and language first", () => {
    const head = parseCustomerHead({ display_name: "Priya S.", status: "new", company_id: null, source: "manual", profile: { source: "indiamart", language: "te", need: "Kanchi silk", city: "Guntur" } });
    expect(head).toMatchObject({ name: "Priya S.", status: "new", companyId: null, source: "indiamart", language: "te" });
    expect(head.profile?.need).toBe("Kanchi silk");
    expect(parseCustomerHead({ display_name: "A", status: "new", source: "manual", profile: { language: "<script>" } })).toMatchObject({ source: "manual", language: null, profile: expect.anything() });
    expect(() => parseCustomerHead({ display_name: "A" })).toThrow();
  });
});

describe("customer page logic", () => {
  it("says the status in plain words, the waiting quote first", () => {
    const st = (items: TimelineItem[] | null, urgency: string | null = null, leadStatus = "qualified") => customerStatus({ items, urgency, leadStatus, now: NOW }, W);
    expect(st([item("quote", "2026-10-01T00:00:00Z", { detail: { status: "draft" } })], "high")).toBe("Waiting for your quote");
    expect(st([item("quote", "2026-11-06T00:00:00Z", { detail: { status: "approved" } })], "high")).toBe("Hot: wants to buy soon");
    expect(st([item("call", "2026-10-27T11:00:00Z")])).toBe("Quiet for 10 days");
    expect(st([item("call", "2026-11-05T11:00:00Z")], null, "new")).toBe("New enquiry");
    expect(st([item("call", "2026-11-05T11:00:00Z")])).toBe("In touch");
    expect(st(null)).toBe("In touch");
  });

  it("finds a waiting quote only among real quotes (not material quotes)", () => {
    expect(waitingQuote([item("quote", "2026-11-06T00:00:00Z", { detail: { status: "draft" } })])).toBe(Q);
    expect(waitingQuote([item("quote", "2026-11-06T00:00:00Z", { target: { type: "material_quote", id: Q }, detail: { status: "draft" } })])).toBeNull();
    expect(waitingQuote(null)).toBeNull();
  });

  it("a quote or an order says its amount and where it stands, in sentence case (owner, 7 Nov); other rows keep their text", () => {
    expect(rowHeading(item("quote", "2026-11-06T00:00:00Z", { text: "Quote 3", detail: { status: "draft", total_paise: 4_800_000 } }), W)).toEqual({ head: "Quote · ₹48,000 · waiting for your OK", body: null });
    expect(rowHeading(item("order", "2026-11-06T00:00:00Z", { text: "Order 7", detail: { state: "advance_paid", total_paise: 12_000_050 } }), W)).toEqual({ head: "Order · ₹1,20,000.50 · advance paid, rest owed", body: null });
    expect(rowHeading(item("order", "2026-11-06T00:00:00Z", { detail: { state: "closed_paid", total_paise: 100 } }), W).head).toBe("Order · ₹1 · paid");
    expect(rowHeading(item("quote", "2026-11-06T00:00:00Z", { text: "Quote 3", detail: { status: "something_new", total_paise: "lots" } }), W)).toEqual({ head: "Quote", body: "Quote 3" });
    expect(rowHeading(item("message_out", "2026-11-06T00:00:00Z", { text: "Here are the photos" }), W)).toEqual({ head: "Our message", body: "Here are the photos" });
  });

  it("never shows a made-up business name or a source code (staging, 7 Nov)", () => {
    expect(businessName("Enquiry 92e730")).toBeNull();
    expect(businessName("Lakshmi Textiles")).toBe("Lakshmi Textiles");
    expect(businessName(null)).toBeNull();
    expect(sourceWords("indiamart", W)).toBe("IndiaMART");
    expect(sourceWords("lead_finder", W)).toBe("Find customers");
    expect(sourceWords("whatsapp", W)).toBe("WhatsApp");
    expect(sourceWords("some_new_source", W)).toBe("some new source");
    expect(sourceWords(null, W)).toBeNull();
  });

  it("lists only what the profile has", () => {
    expect(customerWants(parseProfile({ need: "Kanchi silk", quantity: "20 pieces", area: "Brodipet", city: "Guntur" }), W)).toEqual([
      { label: "Wants", value: "Kanchi silk" },
      { label: "How much", value: "20 pieces" },
      { label: "Where", value: "Brodipet, Guntur" },
    ]);
    expect(customerWants(null, W)).toEqual([]);
  });

  it("has ONE main button: the quote, else the follow-up, else the full lead", () => {
    expect(mainAction({ base: BASE, leadId: LEAD, quoteId: Q, followupDue: true }, W)).toEqual({ href: `${BASE}/quotes/${Q}`, label: "Review the quote" });
    expect(mainAction({ base: BASE, leadId: LEAD, quoteId: null, followupDue: true }, W)).toEqual({ href: `${BASE}/leads/${LEAD}/followup`, label: "Open the follow-up" });
    expect(mainAction({ base: BASE, leadId: LEAD, quoteId: null, followupDue: false }, W)).toEqual({ href: `${BASE}/leads/${LEAD}`, label: "Open the full lead" });
  });

  it("opens a quote, an order or the visits; nothing else; a filter outside the list is All", () => {
    expect(timelineHref(BASE, item("quote", "2026-11-06T00:00:00Z"))).toBe(`${BASE}/quotes/${Q}`);
    expect(timelineHref(BASE, item("order", "2026-11-06T00:00:00Z", { target: { type: "order", id: O } }))).toBe(`${BASE}/orders/${O}`);
    expect(timelineHref(BASE, item("visit", "2026-11-06T00:00:00Z"))).toBe(`${BASE}/visits`);
    expect(timelineHref(BASE, item("order", "2026-11-06T00:00:00Z", { target: { type: "order", id: "../../x" } }))).toBeNull();
    expect(timelineHref(BASE, item("call", "2026-11-06T00:00:00Z"))).toBeNull();
    expect(asFilter("quote")).toBe("quote");
    expect(asFilter("drop table")).toBe("all");
    expect(asFilter(undefined)).toBe("all");
  });
});

describe("CustomerView", () => {
  const ITEMS = [item("call", "2026-11-06T10:00:00Z", { text: "Wants a red Kanchi silk" }), item("quote", "2026-11-05T10:00:00Z", { text: "Quote 12" }), item("message_in", "2026-11-04T10:00:00Z", { text: "Price please" })];
  const props = (over: Partial<CustomerViewProps> = {}): CustomerViewProps => ({
    name: "Priya S.",
    business: "Lakshmi Textiles",
    language: "Telugu",
    source: "IndiaMART",
    status: "Waiting for your quote",
    want: [{ label: "Wants", value: "Kanchi silk" }],
    next: { what: "Follow-up", when: "7 Nov, 10:00 am" },
    main: { href: `${BASE}/quotes/${Q}`, label: "Review the quote" },
    items: ITEMS,
    filter: "all",
    filterHref: (f) => (f === "all" ? "/c" : `/c?kind=${f}`),
    olderHref: "/c?before=x",
    itemHref: (i) => timelineHref(BASE, i),
    when: (iso) => iso.slice(0, 10),
    w: W,
    ...over,
  });

  it("draws the header, the timeline newest first, the side panels and ONE main button", () => {
    render(<CustomerView {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Priya S." })).toBeTruthy();
    expect(screen.getByText("Came from IndiaMART")).toBeTruthy();
    expect(document.querySelector('[data-part="customer-status"]')?.textContent).toBe("Waiting for your quote");
    const rows = Array.from(document.querySelectorAll('[data-part="customer-timeline"] > li')).map((li) => li.getAttribute("data-kind"));
    expect(rows).toEqual(["call", "quote", "message_in"]);
    expect(screen.getByRole("link", { name: /Quote 12/ }).getAttribute("href")).toBe(`${BASE}/quotes/${Q}`);
    // ONE main button: drawn once for a phone (right under the header) and once in the side card; CSS shows one of them
    const mains = Array.from(document.querySelectorAll('[data-part="customer-main"]'));
    expect(mains.map((m) => m.getAttribute("data-at"))).toEqual(["phone", "side"]);
    expect(new Set(mains.map((m) => m.getAttribute("href")))).toEqual(new Set([`${BASE}/quotes/${Q}`]));
    expect(document.querySelector('[data-part="customer-phone"]')?.className).toContain("sm:hidden");
    // the phone's order: the button, What they want as chips, What's next as one line, then the timeline
    const phone = document.querySelector('[data-part="customer-phone"]')!;
    expect(Array.from(phone.children).map((c) => c.getAttribute("data-part"))).toEqual(["customer-main", "customer-want-chips", "customer-next-line"]);
    expect(phone.querySelector('[data-part="customer-next-line"]')?.textContent).toBe("What's next · Follow-up · 7 Nov, 10:00 am");
    expect(screen.getByRole("link", { name: "Show older" }).getAttribute("href")).toBe("/c?before=x");
    const nav = screen.getByRole("navigation", { name: "Show" });
    expect(within(nav).getByRole("link", { name: "All" }).getAttribute("aria-current")).toBe("page");
  });

  it("filters the timeline and says when there is nothing, or it could not be read", () => {
    render(<CustomerView {...props({ filter: "message" })} />);
    expect(Array.from(document.querySelectorAll('[data-part="customer-timeline"] > li')).map((li) => li.getAttribute("data-kind"))).toEqual(["message_in"]);
    cleanup();
    render(<CustomerView {...props({ filter: "order" })} />);
    expect(screen.getByText("Nothing has happened with this customer yet.")).toBeTruthy();
    cleanup();
    render(<CustomerView {...props({ items: null, want: [], next: null, olderHref: null })} />);
    expect(screen.getByText("The timeline could not be read just now.")).toBeTruthy();
    expect(screen.getByText("Nothing noted yet.")).toBeTruthy();
    expect(screen.getByText("Nothing planned.")).toBeTruthy();
    expect(document.querySelector('[data-part="customer-want-chips"]')).toBeNull();
    expect(document.querySelector('[data-part="customer-next-line"]')?.textContent).toBe("What's next · Nothing planned.");
    expect(screen.queryByRole("link", { name: "Show older" })).toBeNull();
  });
});
