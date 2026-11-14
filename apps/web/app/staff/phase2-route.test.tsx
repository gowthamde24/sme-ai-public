import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RedirectError, notFoundMock, redirectMock } from "@/test/helpers";
import { EMPTY_MOCK, type MockState, ticketId } from "@/lib/staff/staff-fixtures";

let path = "/staff/support";
const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => (k === "x-sme-path" ? path : null) }) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
const mfa = { listFactors: vi.fn(), challengeAndVerify: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signOut: vi.fn(), mfa } }) }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
// the sample's memory (a cookie in the browser) is a plain variable here
let jarState: MockState = EMPTY_MOCK;
vi.mock("@/lib/mock/jar", () => ({
  readJar: async () => jarState,
  writeJar: async (_n: string, v: MockState) => {
    jarState = v;
    return true;
  },
  clearJar: async () => undefined,
}));
const apiTickets = vi.fn();
const apiGoodwill = vi.fn();
vi.mock("@/lib/staff/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/staff/api")>()), apiMe: vi.fn(), apiOverview: vi.fn(), apiTickets: (...a: unknown[]) => apiTickets(...a), apiGoodwill: (...a: unknown[]) => apiGoodwill(...a) }));

import { assignAction, confirmCodeAction, creditAction, pauseAction, replyAction, resumeAction, statusAction, unmaskAction } from "./actions";
import ConsoleLayout from "./(console)/layout";
import BusinessesPage from "./(console)/businesses/page";
import SupportPage from "./(console)/support/page";
import TicketPage from "./(console)/support/[ticketId]/page";

const BIZ = "00000000-0000-4000-8000-000000000001";
const USER = { id: "u1", email: "staff@example.test", accessToken: "tok" };
const keep = { ...process.env };
async function draw(page: () => Promise<ReactElement | null>) {
  render(await ConsoleLayout({ children: await page() }));
}
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  jarState = EMPTY_MOCK;
  path = "/staff/support";
  requireUser.mockResolvedValue(USER);
  process.env.STAFF_CONSOLE = "mock";
});
afterEach(() => {
  cleanup();
  process.env = { ...keep };
});

describe("the pages", () => {
  it("Support draws the inbox inside the console with Support marked in the menu; ?status= picks a chip; nonsense falls back to Active", async () => {
    await draw(() => SupportPage(sp()));
    expect(screen.getByRole("heading", { level: 1, name: "Support" })).toBeInTheDocument();
    expect(screen.getAllByText("Sri Venkateswara Sarees").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /^Support/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("aria-current", "true");
    cleanup();
    await draw(() => SupportPage(sp({ status: "closed" })));
    expect(screen.getByRole("link", { name: "Closed" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("No tickets here.")).toBeInTheDocument();
    cleanup();
    await draw(() => SupportPage(sp({ status: "weird" })));
    expect(screen.getByRole("link", { name: "Active" })).toHaveAttribute("aria-current", "true");
  });
  it("finance gets one plain sentence, not the inbox; a session that ended goes to sign in", async () => {
    path = "/staff/support?role=finance";
    await draw(() => SupportPage(sp()));
    expect(screen.getByText("This area is not for your role.")).toBeInTheDocument();
    expect(screen.queryByText("Sri Venkateswara Sarees")).toBeNull();
    cleanup();
    process.env.STAFF_CONSOLE = "1";
    const { ApiAuthError } = await import("@/lib/api/client");
    const { apiMe, apiOverview } = await import("@/lib/staff/api");
    const { overviewJson } = await import("@/lib/staff/staff-fixtures");
    const { parseOverview } = await import("@/lib/staff/types");
    vi.mocked(apiMe).mockResolvedValue({ staffId: "s", name: "X", role: "owner", secondFactor: true });
    vi.mocked(apiOverview).mockResolvedValue(parseOverview(overviewJson("owner")));
    apiTickets.mockRejectedValue(new ApiAuthError());
    await expect(draw(() => SupportPage(sp()))).rejects.toThrow(RedirectError);
  });
  it("a ticket opens its thread with a back link; an unknown ticket says so", async () => {
    path = `/staff/support/${ticketId(2)}`;
    await draw(() => TicketPage({ params: Promise.resolve({ ticketId: ticketId(2) }) } as never));
    expect(screen.getByRole("heading", { level: 1, name: "Meenakshi Silks" })).toBeInTheDocument();
    expect(screen.getByText("How to add second phone number?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Support" })).toHaveAttribute("href", "/staff/support");
    cleanup();
    await draw(() => TicketPage({ params: Promise.resolve({ ticketId: "10000000-0000-4000-8000-000000000099" }) } as never));
    expect(screen.getByText("That ticket was not found.")).toBeInTheDocument();
  });
  it("Businesses lists them and searches with ?q=", async () => {
    path = "/staff/businesses";
    await draw(() => BusinessesPage(sp()));
    expect(screen.getByRole("heading", { level: 1, name: "Businesses" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /^Businesses/ })).toHaveAttribute("aria-current", "page");
    cleanup();
    await draw(() => BusinessesPage(sp({ q: "Mysuru" })));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Vasavi Pattu Centre")).toBeInTheDocument();
  });
});

describe("the actions check what they are given", () => {
  it("reply: a ticket id, 1 to 4,000 characters, reply or note only; the sample remembers it", async () => {
    for (const bad of [replyAction("", "x", "reply"), replyAction(ticketId(1), "   ", "reply"), replyAction(ticketId(1), "x".repeat(4001), "note"), replyAction(ticketId(1), "x", "shout"), replyAction("../etc", "x", "note")]) expect(await bad).toEqual({ ok: false, failure: "invalid" });
    const ok = await replyAction(ticketId(1), "  Looking now ", "reply");
    expect(ok.ok && ok.data.messages.at(-1)?.body).toBe("Looking now");
    expect(jarState.tickets["1"]?.status).toBe("waiting");
  });
  it("status and assign: closed words only; an unknown ticket is not_found", async () => {
    expect(await statusAction(ticketId(1), "deleted")).toEqual({ ok: false, failure: "invalid" });
    expect(await assignAction(ticketId(1), "everyone")).toEqual({ ok: false, failure: "invalid" });
    expect(await statusAction("10000000-0000-4000-8000-000000000099", "closed")).toEqual({ ok: false, failure: "not_found" });
    const s = await statusAction(ticketId(1), "closed");
    expect(s.ok && s.data.status).toBe("closed");
  });
  it("pause and resume: a real business id, a reason code, words for 'other'", async () => {
    expect(await pauseAction("nope", "incident", "")).toEqual({ ok: false, failure: "invalid" });
    expect(await pauseAction(BIZ, "whim", "")).toEqual({ ok: false, failure: "reason_required" });
    expect(await pauseAction(BIZ, "other", "ab")).toEqual({ ok: false, failure: "reason_required" });
    const p = await pauseAction(BIZ, "incident", "");
    expect(p.ok && p.data.status).toBe("paused");
    const r = await resumeAction(BIZ, "incident", "");
    expect(r.ok && r.data.status).toBe("live");
  });
  it("credit: whole rupees from 100 to 1,000 typed twice, a reason AND words, a key; a fresh code is asked first", async () => {
    const form = { amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "Double charged", key: "gw-abcdefgh" };
    for (const bad of [{ ...form, amountPaise: 50_050, confirmPaise: 50_050 }, { ...form, amountPaise: 5_000, confirmPaise: 5_000 }, { ...form, amountPaise: 200_000, confirmPaise: 200_000 }, { ...form, confirmPaise: 40_000 }, { ...form, key: "short" }, { ...form, key: "has space in it" }]) expect(await creditAction(BIZ, bad)).toEqual({ ok: false, failure: "invalid" });
    expect(await creditAction(BIZ, { ...form, text: "  " })).toEqual({ ok: false, failure: "reason_required" });
    expect(await creditAction(BIZ, { ...form, code: "whim" })).toEqual({ ok: false, failure: "reason_required" });
    expect(await creditAction(BIZ, form)).toEqual({ ok: false, failure: "second_confirm_required" });
    expect(await confirmCodeAction("12 34 56")).toEqual({ ok: true });
    const ok = await creditAction(BIZ, form);
    expect(ok.ok && ok.data.creditedText).toBe("₹500");
  });
  it("the real API: the credit goes through with the same key it was given; the code is checked by the authenticator, not by us", async () => {
    process.env.STAFF_CONSOLE = "1";
    const { apiMe } = await import("@/lib/staff/api");
    vi.mocked(apiMe).mockResolvedValue({ staffId: "s", name: "X", role: "finance", secondFactor: true });
    apiGoodwill.mockResolvedValue({ creditedText: "₹500", balanceText: "₹2,050", replayed: false });
    const form = { amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "Double charged", key: "gw-abcdefgh" };
    expect((await creditAction(BIZ, form)).ok).toBe(true);
    expect(apiGoodwill).toHaveBeenCalledWith("tok", BIZ, { amountPaise: 50_000, confirmPaise: 50_000, code: "billing_dispute", text: "Double charged", key: "gw-abcdefgh" });
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: "f1" }] } });
    mfa.challengeAndVerify.mockResolvedValueOnce({ error: { message: "bad" } }).mockResolvedValueOnce({ error: null });
    expect(await confirmCodeAction("12345")).toEqual({ ok: false, failure: "invalid" }); // not six digits: never sent
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
    expect(await confirmCodeAction("123456")).toEqual({ ok: false, failure: "invalid" });
    expect(await confirmCodeAction("123456")).toEqual({ ok: true });
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f1", code: "123456" });
    mfa.listFactors.mockResolvedValue({ data: { totp: [] } });
    expect(await confirmCodeAction("123456")).toEqual({ ok: false, failure: "no_access" });
  });
  it("unmask: needs the access id, a reason code and words every time", async () => {
    expect(await unmaskAction(BIZ, "", "incident", "checking a complaint")).toEqual({ ok: false, failure: "invalid" });
    expect(await unmaskAction(BIZ, `mock-access-${BIZ}`, "incident", "  ")).toEqual({ ok: false, failure: "reason_required" });
    expect(await unmaskAction(BIZ, `mock-access-${BIZ}`, "whim", "checking a complaint")).toEqual({ ok: false, failure: "reason_required" });
    const ok = await unmaskAction(BIZ, `mock-access-${BIZ}`, "incident", "checking a complaint");
    expect(ok.ok && ok.data.calls[0].customer).toBe("Padmaja Naidu");
  });
});
