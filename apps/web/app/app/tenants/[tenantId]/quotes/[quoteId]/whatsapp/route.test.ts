import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { WHATSAPP_CODES } from "@/lib/whatsapp/codes";
import { MAX_LINK_TEXT_ENCODED } from "@/lib/whatsapp/limit";
import { RedirectError, isNotFound, notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const fetchQuote = vi.fn();
const fetchQuoteText = vi.fn();
const fetchLeadFollowup = vi.fn();
const fetchLeadContactId = vi.fn();
const fetchContactPhone = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/quotes", () => ({ fetchQuote: (...a: unknown[]) => fetchQuote(...a), fetchQuoteText: (...a: unknown[]) => fetchQuoteText(...a) }));
vi.mock("@/lib/api/followups", () => ({ fetchLeadFollowup: (...a: unknown[]) => fetchLeadFollowup(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));
vi.mock("@/lib/api/contact-phone", () => ({ fetchContactPhone: (...a: unknown[]) => fetchContactPhone(...a) }));

import { GET } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const Q = "88888888-8888-4888-8888-888888888888";
const E = "44444444-4444-4444-8444-444444444444";
const L = "33333333-3333-4333-8333-333333333333";
const C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CANARY = "CANARY-7d41";
const PHONE = "98765 43210"; // a synthetic placeholder
const DIGITS = "919876543210";
const TEXT = "Quote Q-00001\nTotal: ₹79,859.00";
const NOW = new Date("2026-10-08T06:00:00Z"); // 11:30 in India on 2026-10-08

const BACK = (code: string) => `/app/tenants/${T}/enquiries/${E}?quote=${Q}&whatsapp=${code}`;

function call(search = "", site: string | null = "same-origin", ids: { t?: string; q?: string } = {}) {
  const headers: Record<string, string> = site === null ? {} : { "sec-fetch-site": site };
  return GET(new NextRequest(`http://localhost/app/tenants/${T}/quotes/${Q}/whatsapp${search}`, { headers }), { params: Promise.resolve({ tenantId: ids.t ?? T, quoteId: ids.q ?? Q }) });
}

function quote(over: Record<string, unknown> = {}) {
  return { id: Q, enquiry_id: E, lead_id: L, outcome: "approved", valid_until: "2026-10-20", ...over };
}

function everyRead() {
  return [fetchTenant, fetchQuote, fetchLeadFollowup, fetchQuoteText, fetchLeadContactId, fetchContactPhone];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, role: "sales" });
  fetchQuote.mockResolvedValue(quote());
  fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: null, stopped: null, policy_in_force: true }, channels: [] });
  fetchQuoteText.mockResolvedValue({ text: TEXT });
  fetchLeadContactId.mockResolvedValue(C);
  fetchContactPhone.mockResolvedValue(PHONE);
});
afterEach(() => vi.useRealTimers());

describe("the happy path", () => {
  it("answers 302 to wa.me with the number and the whole approved text, and nothing else", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://wa.me/${DIGITS}?text=${encodeURIComponent(TEXT)}`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await res.text()).toBe("");
  });

  it("reads everything with the caller's own token, and the lead, contact and text from the quote on the server", async () => {
    await call();
    expect(fetchTenant).toHaveBeenCalledWith("tok", T);
    expect(fetchQuote).toHaveBeenCalledWith("tok", T, Q);
    expect(fetchLeadFollowup).toHaveBeenCalledWith("tok", T, L, "whatsapp");
    expect(fetchQuoteText).toHaveBeenCalledWith("tok", T, Q);
    expect(fetchLeadContactId).toHaveBeenCalledWith("tok", T, L);
    expect(fetchContactPhone).toHaveBeenCalledWith("tok", T, C);
  });

  it.each(["owner", "admin", "sales"])("a %s may open it", async (role) => {
    fetchTenant.mockResolvedValue({ id: T, role });
    expect((await call()).status).toBe(302);
  });

  it("takes nothing from the query string except chat=1", async () => {
    const res = await call(`?text=evil&phone=123&lead=${E}&to=https://evil.example&digits=1`);
    expect(res.headers.get("Location")).toBe(`https://wa.me/${DIGITS}?text=${encodeURIComponent(TEXT)}`);
    expect(fetchLeadFollowup).toHaveBeenCalledWith("tok", T, L, "whatsapp");
  });

  it("an Indian number with its country code written out keeps it; another country keeps its own", async () => {
    fetchContactPhone.mockResolvedValue("+44 20 7946 0958");
    expect((await call()).headers.get("Location")).toBe(`https://wa.me/442079460958?text=${encodeURIComponent(TEXT)}`);
  });

  it("the text is whole and exactly at the limit still goes in the link", async () => {
    fetchQuoteText.mockResolvedValue({ text: "a".repeat(MAX_LINK_TEXT_ENCODED) });
    const res = await call();
    expect(res.headers.get("Location")).toBe(`https://wa.me/${DIGITS}?text=${"a".repeat(MAX_LINK_TEXT_ENCODED)}`);
  });
});

describe("the order of the checks, and what is read before each refusal", () => {
  it("no session: the login redirect, nothing read", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
    for (const read of everyRead()) expect(read).not.toHaveBeenCalled();
  });

  it.each([["not-a-uuid", Q], [T, "not-a-uuid"], ["22222222-2222-4222-8222-22222222222", Q], [T, "../88888888-8888-4888-8888-888888888888"], [T, ""]])("a malformed id (%j, %j) is a plain not-found and nothing is read", async (t, q) => {
    expect(await isNotFound(() => call("", "same-origin", { t, q }))).toBe(true);
    for (const read of everyRead()) expect(read).not.toHaveBeenCalled();
  });

  it("a session the API rejects goes to the login page", async () => {
    fetchTenant.mockRejectedValue(new ApiAuthError());
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("another workspace (404 from the API) is a plain not-found", async () => {
    fetchTenant.mockRejectedValue(new ApiRequestError(404, "not_found", "Not found."));
    expect(await isNotFound(() => call())).toBe(true);
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("a viewer gets 403 and the quote is never read", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "viewer" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.headers.get("Location")).toBeNull();
    for (const read of [fetchQuote, fetchLeadFollowup, fetchQuoteText, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("an unknown or foreign quote (404) is a plain not-found, and nothing after it is read", async () => {
    fetchQuote.mockRejectedValue(new ApiRequestError(404, "not_found", "Not found."));
    expect(await isNotFound(() => call())).toBe(true);
    for (const read of [fetchLeadFollowup, fetchQuoteText, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("a workspace that cannot be read at all is a fixed 503 sentence", async () => {
    fetchTenant.mockRejectedValue(new Error(`boom ${CANARY}`));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(CANARY);
  });
});

describe("Sec-Fetch-Site: the click must come from this site's own page", () => {
  it.each([[null], ["cross-site"], ["same-site"], [""], ["SAME-ORIGIN "], ["anything"]])("a header of %j sends the person back with not_from_here and reads nothing more", async (site) => {
    const res = await call("", site);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(BACK("not_from_here"));
    for (const read of [fetchLeadFollowup, fetchQuoteText, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it.each([["same-origin"], ["none"]])("%s is accepted", async (site) => {
    expect((await call("", site)).headers.get("Location")).toContain("https://wa.me/");
  });
});

describe("every refusal is a redirect back to the quote screen with ONE closed code", () => {
  const expectBack = async (res: Response, code: string) => {
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(BACK(code));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  };

  it.each(["draft", "rejected", "withdrawn", "superseded"])("a %s quote: not_approved, and the gate, the text and the number are never read", async (outcome) => {
    fetchQuote.mockResolvedValue(quote({ outcome }));
    await expectBack(await call(), "not_approved");
    for (const read of [fetchLeadFollowup, fetchQuoteText, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("the API saying the quote is not approved while the outcome said approved: not_approved", async () => {
    fetchQuoteText.mockRejectedValue(new ApiRequestError(409, "quote_not_approved", "Only an approved quote has customer text."));
    await expectBack(await call(), "not_approved");
    expect(fetchContactPhone).not.toHaveBeenCalled();
  });

  it("an expired quote: valid through its last day in India, so today is still fine and yesterday is not", async () => {
    fetchQuote.mockResolvedValue(quote({ valid_until: "2026-10-08" }));
    expect((await call()).headers.get("Location")).toContain("https://wa.me/");
    fetchQuote.mockResolvedValue(quote({ valid_until: "2026-10-07" }));
    await expectBack(await call(), "expired");
    expect(fetchContactPhone).toHaveBeenCalledTimes(1); // only the first call got that far
  });

  it("the India date decides, not UTC: at 20:00 UTC on 10-07 it is already 10-08 in India", async () => {
    vi.setSystemTime(new Date("2026-10-07T20:00:00Z"));
    fetchQuote.mockResolvedValue(quote({ valid_until: "2026-10-07" }));
    await expectBack(await call(), "expired");
  });

  it("a valid_until that is not a date counts as expired", async () => {
    fetchQuote.mockResolvedValue(quote({ valid_until: "soon" }));
    await expectBack(await call(), "expired");
  });

  it.each(["consent", "contact", "key", "erased", "unkeyed"])("the database's gate word %s: that code, and the text and the number are never read", async (word) => {
    fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: word, stopped: null, policy_in_force: true }, channels: [] });
    await expectBack(await call(), word);
    for (const read of [fetchQuoteText, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("a gate word we do not know is unavailable, never passed on", async () => {
    fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: `new-word-${CANARY}`, stopped: null, policy_in_force: true }, channels: [] });
    const res = await call();
    await expectBack(res, "unavailable");
  });

  it("an answer for another channel is unavailable", async () => {
    fetchLeadFollowup.mockResolvedValue({ channel: "email", gate: { blocked: null, stopped: null, policy_in_force: true }, channels: [] });
    await expectBack(await call(), "unavailable");
    expect(fetchContactPhone).not.toHaveBeenCalled();
  });

  it("too long for a link: too_long and the number is never read; chat=1 opens the chat alone", async () => {
    const long = "₹".repeat(300);
    fetchQuoteText.mockResolvedValue({ text: long });
    await expectBack(await call(), "too_long");
    expect(fetchContactPhone).not.toHaveBeenCalled();
    const chat = await call("?chat=1");
    expect(chat.status).toBe(302);
    expect(chat.headers.get("Location")).toBe(`https://wa.me/${DIGITS}`);
  });

  it("one character over the limit is too long, never cut", async () => {
    fetchQuoteText.mockResolvedValue({ text: "a".repeat(MAX_LINK_TEXT_ENCODED + 1) });
    await expectBack(await call(), "too_long");
  });

  it("chat=1 on a text that fits is still the chat alone (the person asked for no text)", async () => {
    expect((await call("?chat=1")).headers.get("Location")).toBe(`https://wa.me/${DIGITS}`);
    expect((await call("?chat=0")).headers.get("Location")).toContain("?text=");
  });

  it("a lead with no contact, or a contact with no number: no_phone", async () => {
    fetchLeadContactId.mockResolvedValue(null);
    await expectBack(await call(), "no_phone");
    fetchLeadContactId.mockResolvedValue(C);
    fetchContactPhone.mockResolvedValue(null);
    await expectBack(await call(), "no_phone");
  });

  it.each([["+00 90000 20001"], ["919876543210"], ["098765 43210"], ["call me"], [""]])("a stored number that is not usable (%j): bad_number, and the number appears nowhere in the response", async (stored) => {
    fetchContactPhone.mockResolvedValue(stored);
    const res = await call();
    await expectBack(res, "bad_number");
    expect(JSON.stringify([...res.headers.entries()])).not.toContain(stored === "" ? "\u0000" : stored);
  });

  it("any other failure is unavailable", async () => {
    fetchQuoteText.mockRejectedValue(new ApiRequestError(503, "quote_text_unavailable", "Quote text is not available right now."));
    await expectBack(await call(), "unavailable");
    fetchQuoteText.mockResolvedValue({ text: TEXT });
    fetchContactPhone.mockRejectedValue(new Error("boom"));
    await expectBack(await call(), "unavailable");
  });

  it("a session that expires in the middle goes to the login page", async () => {
    fetchLeadContactId.mockRejectedValue(new ApiAuthError());
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("no text from the API or the database, and no number, in any response that is not the redirect to WhatsApp", () => {
  const spies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => undefined));

  const failures: [string, () => void][] = [
    ["tenant read fails", () => fetchTenant.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["quote read fails", () => fetchQuote.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["gate read fails", () => fetchLeadFollowup.mockRejectedValue(new ApiRequestError(500, "boom", `x ${CANARY} ${PHONE}`))],
    ["text read fails", () => fetchQuoteText.mockRejectedValue(new ApiRequestError(409, "quote_text_refused", `x ${CANARY} ${PHONE}`))],
    ["contact read fails", () => fetchLeadContactId.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["phone read fails", () => fetchContactPhone.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["gate word is new", () => fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: `${CANARY} ${PHONE}`, stopped: null, policy_in_force: true }, channels: [] })],
    ["number is not usable", () => fetchContactPhone.mockResolvedValue(`${PHONE} ${CANARY}`)],
  ];

  it.each(failures)("%s: no canary, no number, a closed code or a fixed sentence only", async (_name, arrange) => {
    arrange();
    const res = await call();
    const everything = `${JSON.stringify([...res.headers.entries()])}${await res.text()}`;
    expect(everything).not.toContain(CANARY);
    expect(everything).not.toContain(PHONE);
    expect(everything).not.toContain(PHONE.replace(/\s/g, ""));
    expect(everything).not.toContain(DIGITS);
    expect(everything).not.toContain("wa.me");
    const location = res.headers.get("Location");
    if (location !== null) {
      const code = new URL(location, "http://localhost").searchParams.get("whatsapp");
      expect(location).toBe(`/app/tenants/${T}/enquiries/${E}?quote=${Q}&whatsapp=${code}`);
      expect((WHATSAPP_CODES as readonly string[]).includes(String(code))).toBe(true);
    } else {
      expect(res.status).toBe(503);
    }
  });

  it("the quote's own fields cannot steer the back address: it is built from the path ids and the quote's ids only", async () => {
    fetchQuote.mockResolvedValue(quote({ outcome: "draft" }));
    const res = await call(`?whatsapp=evil&next=https://evil.example`);
    expect(res.headers.get("Location")).toBe(BACK("not_approved"));
  });

  it("nothing is logged on any path", async () => {
    await call();
    fetchContactPhone.mockRejectedValue(new Error(CANARY));
    await call();
    fetchQuote.mockResolvedValue(quote({ outcome: "draft" }));
    await call();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
