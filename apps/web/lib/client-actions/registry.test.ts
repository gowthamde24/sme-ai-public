import { describe, expect, it } from "vitest";

import { hrefOf } from "./href";
import { parseClientAction } from "./registry";

const B = "/app/tenants/c029cba3-d2f8-4923-8c5a-630852797fd3";
const L = "0b6c2f2e-9d8a-4c53-8a43-6f1c0d6a2b11";
const card = (action: string, args: Record<string, unknown> = {}) => ({ kind: "client_action", id: "x", action, args });

describe("the browser actions the assistant may run", () => {
  it("theme and language: only the listed values", () => {
    expect(parseClientAction(card("theme", { mode: "dark" }))).toEqual({ action: "theme", mode: "dark" });
    expect(parseClientAction(card("theme", { mode: "blue" }))).toBeNull();
    expect(parseClientAction(card("language", { lang: "te" }))).toEqual({ action: "language", lang: "te" });
    expect(parseClientAction(card("language", { lang: "ta" }))).toBeNull();
  });

  it("navigate builds the page's own address; only Reports takes a period, and a period it does not know is refused", () => {
    expect(hrefOf(parseClientAction(card("navigate", { page: "leads" }))!, B)).toBe(`${B}/leads`);
    expect(hrefOf(parseClientAction(card("navigate", { page: "today" }))!, B)).toBe(B);
    expect(hrefOf(parseClientAction(card("navigate", { page: "phone_numbers" }))!, B)).toBe(`${B}/phone-number`);
    expect(hrefOf(parseClientAction(card("navigate", { page: "reports", period: "month" }))!, B)).toBe(`${B}/report?range=month`);
    expect(hrefOf(parseClientAction(card("navigate", { page: "reports", period: "today" }))!, B)).toBe(`${B}/report?range=today`);
    expect(hrefOf(parseClientAction(card("navigate", { page: "reports", period: { from: "2026-10-01", to: "2026-10-31" } }))!, B)).toBe(`${B}/report?range=custom&from=2026-10-01&to=2026-10-31`);
    expect(parseClientAction(card("navigate", { page: "reports", period: "decade" }))).toBeNull();
    expect(parseClientAction(card("navigate", { page: "reports", period: { from: "2026-10-31", to: "2026-10-01" } }))).toBeNull();
    expect(parseClientAction(card("navigate", { page: "admin" }))).toBeNull();
    expect(parseClientAction(card("navigate", { page: "leads", period: "month" }))).toMatchObject({ period: null }); // a page without periods ignores it
  });

  it("open_record needs a canonical id and builds the record's address from a closed type", () => {
    expect(hrefOf(parseClientAction(card("open_record", { type: "lead", id: L }))!, B)).toBe(`${B}/leads/${L}`);
    expect(hrefOf(parseClientAction(card("open_record", { type: "chat", id: L }))!, B)).toBe(`${B}/chats/${L}`);
    expect(parseClientAction(card("open_record", { type: "lead", id: "../../login" }))).toBeNull();
    expect(parseClientAction(card("open_record", { type: "invoice", id: L }))).toBeNull();
  });

  it("filter is Calls only, with the closed statuses and ranges; the search words are cleaned and cut", () => {
    expect(hrefOf(parseClientAction(card("filter", { page: "calls", status: "no_answer", when: "7d" }))!, B)).toBe(`${B}/calls?status=no_answer&when=7d`);
    expect(hrefOf(parseClientAction(card("filter", { page: "calls", q: "  Ravi   Kumar " }))!, B)).toBe(`${B}/calls?q=Ravi+Kumar`);
    expect(parseClientAction(card("filter", { page: "leads", status: "new" }))).toBeNull();
    expect(parseClientAction(card("filter", { page: "calls", status: "angry" }))).toBeNull();
    const long = parseClientAction(card("filter", { page: "calls", q: "x".repeat(300) }));
    expect(long && long.action === "filter" ? long.q.length : 0).toBe(80);
  });

  it("settings sections and Talk live", () => {
    expect(hrefOf(parseClientAction(card("open_settings", { section: "limits" }))!, B)).toBe(`${B}/settings?section=limits`);
    expect(parseClientAction(card("open_settings", { section: "secrets" }))).toBeNull();
    expect(parseClientAction(card("talk_live", { state: "start" }))).toEqual({ action: "talk_live", state: "start" });
    expect(parseClientAction(card("talk_live", { state: "pause" }))).toBeNull();
    expect(hrefOf({ action: "talk_live", state: "stop" }, B)).toBeNull();
  });

  it("an action the registry does not list is not run", () => {
    for (const a of ["delete_everything", "eval", "open_url", ""]) expect(parseClientAction(card(a, { url: "https://evil.example" }))).toBeNull();
    expect(parseClientAction(null)).toBeNull();
    expect(parseClientAction("theme")).toBeNull();
  });
});
