import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { WHATSAPP_CODES } from "@/lib/whatsapp/codes";
import { MAX_LINK_TEXT_ENCODED } from "@/lib/whatsapp/limit";
import { RedirectError, isNotFound, notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
const fetchTenant = vi.fn();
const getOutboxMessage = vi.fn();
const fetchLeadFollowup = vi.fn();
const fetchLeadContactId = vi.fn();
const fetchContactPhone = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/api/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/client")>()), fetchTenant: (...a: unknown[]) => fetchTenant(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), getOutboxMessage: (...a: unknown[]) => getOutboxMessage(...a) }));
vi.mock("@/lib/api/followups", () => ({ fetchLeadFollowup: (...a: unknown[]) => fetchLeadFollowup(...a) }));
vi.mock("@/lib/api/lead-contact", () => ({ fetchLeadContactId: (...a: unknown[]) => fetchLeadContactId(...a) }));
vi.mock("@/lib/api/contact-phone", () => ({ fetchContactPhone: (...a: unknown[]) => fetchContactPhone(...a) }));

import { GET } from "./route";

const T = "22222222-2222-4222-8222-222222222222";
const M = "88888888-8888-4888-8888-888888888888";
const L = "33333333-3333-4333-8333-333333333333";
const C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const CANARY = "CANARY-7d41";
const PHONE = "98765 43210"; // a synthetic placeholder
const DIGITS = "919876543210";
const TEXT = "Hello, your visit is on Saturday at 11.";

const BACK = (code: string) => `/app/tenants/${T}/outbox?tab=scheduled&whatsapp=${code}`;

function call(search = "", site: string | null = "same-origin", ids: { t?: string; m?: string } = {}) {
  const headers: Record<string, string> = site === null ? {} : { "sec-fetch-site": site };
  return GET(new NextRequest(`http://localhost/app/tenants/${T}/outbox/${M}/whatsapp${search}`, { headers }), { params: Promise.resolve({ tenantId: ids.t ?? T, messageId: ids.m ?? M }) });
}

const message = (over: Record<string, unknown> = {}) => ({ id: M, lead_id: L, text: TEXT, status: "queued", reason: "owner_approved", decided_at: "2026-11-13T06:00:00Z", ...over });
const everyRead = () => [fetchTenant, getOutboxMessage, fetchLeadFollowup, fetchLeadContactId, fetchContactPhone];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OUTBOX_WHATSAPP", "mock");
  requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
  fetchTenant.mockResolvedValue({ id: T, role: "owner" });
  getOutboxMessage.mockResolvedValue(message());
  fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: null, stopped: null, policy_in_force: true }, channels: [] });
  fetchLeadContactId.mockResolvedValue(C);
  fetchContactPhone.mockResolvedValue(PHONE);
});
afterEach(() => vi.unstubAllEnvs());

describe("the flag", () => {
  it.each([[undefined], [""], ["0"], ["true"]])("OUTBOX_WHATSAPP %j: a plain not-found and nothing is read", async (value) => {
    if (value === undefined) vi.stubEnv("OUTBOX_WHATSAPP", ""); else vi.stubEnv("OUTBOX_WHATSAPP", value);
    expect(await isNotFound(() => call())).toBe(true);
    for (const read of [requireUser, ...everyRead()]) expect(read).not.toHaveBeenCalled();
  });

  it.each([["mock"], ["1"]])("%s works", async (value) => {
    vi.stubEnv("OUTBOX_WHATSAPP", value);
    expect((await call()).status).toBe(302);
  });
});

describe("the happy path", () => {
  it("answers 302 to wa.me with the number and the whole text, and nothing else", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`https://wa.me/${DIGITS}?text=${encodeURIComponent(TEXT)}`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await res.text()).toBe("");
  });

  it("reads with the caller's own token, and the lead, contact and words from the message on the server", async () => {
    await call(`?text=evil&phone=123&lead=${T}`);
    expect(getOutboxMessage).toHaveBeenCalledWith("tok", T, M);
    expect(fetchLeadFollowup).toHaveBeenCalledWith("tok", T, L, "whatsapp");
    expect(fetchLeadContactId).toHaveBeenCalledWith("tok", T, L);
    expect(fetchContactPhone).toHaveBeenCalledWith("tok", T, C);
  });

  it("chat=1 opens the chat alone", async () => {
    expect((await call("?chat=1")).headers.get("Location")).toBe(`https://wa.me/${DIGITS}`);
  });
});

describe("who and what", () => {
  it("only Owner and Admin: a sales person and a viewer get 403, nothing more is read", async () => {
    for (const role of ["sales", "viewer"]) {
      fetchTenant.mockResolvedValue({ id: T, role });
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.headers.get("Location")).toBeNull();
    }
    for (const read of [getOutboxMessage, fetchLeadFollowup, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("admin may", async () => {
    fetchTenant.mockResolvedValue({ id: T, role: "admin" });
    expect((await call()).status).toBe(302);
  });

  it("a malformed id is a not-found and nothing is read", async () => {
    expect(await isNotFound(() => call("", "same-origin", { m: "../x" }))).toBe(true);
    expect(await isNotFound(() => call("", "same-origin", { t: "nope" }))).toBe(true);
    for (const read of everyRead()) expect(read).not.toHaveBeenCalled();
  });

  it("no session, a rejected session: the login page", async () => {
    requireUser.mockImplementation(() => redirectMock("/login"));
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
    requireUser.mockResolvedValue({ id: "u", email: "e", accessToken: "tok" });
    fetchTenant.mockRejectedValue(new ApiAuthError());
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
  });

  it("an unknown or foreign message is a not-found; an unreadable workspace is a fixed 503", async () => {
    getOutboxMessage.mockRejectedValue(new ApiRequestError(404, "not_found", "Not found."));
    expect(await isNotFound(() => call())).toBe(true);
    fetchTenant.mockRejectedValue(new Error(`boom ${CANARY}`));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(CANARY);
  });

  it.each([["needs_approval", null, "money"], ["sent", "2026-11-13T06:00:00Z", "owner_approved"], ["blocked", "2026-11-13T06:00:00Z", "owner_rejected"], ["failed", "2026-11-13T06:00:00Z", "send_failed"], ["queued", null, "auto_allowed"]])("a %s message (decided %j, %s): not_approved, the gate and the number are never read", async (status, decided_at, reason) => {
    getOutboxMessage.mockResolvedValue(message({ status, decided_at, reason }));
    const res = await call();
    expect(res.headers.get("Location")).toBe(BACK("not_approved"));
    for (const read of [fetchLeadFollowup, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });
});

describe("Sec-Fetch-Site and the closed codes", () => {
  it.each([[null], ["cross-site"], ["same-site"], [""]])("a header of %j: not_from_here, nothing more read", async (site) => {
    const res = await call("", site);
    expect(res.headers.get("Location")).toBe(BACK("not_from_here"));
    for (const read of [fetchLeadFollowup, fetchLeadContactId, fetchContactPhone]) expect(read).not.toHaveBeenCalled();
  });

  it("none is accepted (the address typed in)", async () => {
    expect((await call("", "none")).headers.get("Location")).toContain("https://wa.me/");
  });

  it.each(["consent", "contact", "key", "erased", "unkeyed"])("gate word %s: that code, the number never read", async (word) => {
    fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: word, stopped: null, policy_in_force: true }, channels: [] });
    expect((await call()).headers.get("Location")).toBe(BACK(word));
    expect(fetchContactPhone).not.toHaveBeenCalled();
  });

  it("an unknown gate word, another channel and a failed read are unavailable", async () => {
    fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: `${CANARY}`, stopped: null, policy_in_force: true }, channels: [] });
    expect((await call()).headers.get("Location")).toBe(BACK("unavailable"));
    fetchLeadFollowup.mockResolvedValue({ channel: "email", gate: { blocked: null, stopped: null, policy_in_force: true }, channels: [] });
    expect((await call()).headers.get("Location")).toBe(BACK("unavailable"));
    fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: null, stopped: null, policy_in_force: true }, channels: [] });
    fetchContactPhone.mockRejectedValue(new Error(CANARY));
    expect((await call()).headers.get("Location")).toBe(BACK("unavailable"));
  });

  it("too long for a link: too_long and no number read; one over the limit is too long, never cut", async () => {
    getOutboxMessage.mockResolvedValue(message({ text: "a".repeat(MAX_LINK_TEXT_ENCODED + 1) }));
    expect((await call()).headers.get("Location")).toBe(BACK("too_long"));
    expect(fetchContactPhone).not.toHaveBeenCalled();
    getOutboxMessage.mockResolvedValue(message({ text: "a".repeat(MAX_LINK_TEXT_ENCODED) }));
    expect((await call()).headers.get("Location")).toContain("https://wa.me/");
  });

  it("no contact, no number, a number that cannot be used", async () => {
    fetchLeadContactId.mockResolvedValue(null);
    expect((await call()).headers.get("Location")).toBe(BACK("no_phone"));
    fetchLeadContactId.mockResolvedValue(C);
    fetchContactPhone.mockResolvedValue(null);
    expect((await call()).headers.get("Location")).toBe(BACK("no_phone"));
    fetchContactPhone.mockResolvedValue("+00 90000 20001");
    expect((await call()).headers.get("Location")).toBe(BACK("bad_number"));
  });

  it("a session that expires in the middle goes to the login page", async () => {
    fetchLeadContactId.mockRejectedValue(new ApiAuthError());
    await expect(call()).rejects.toBeInstanceOf(RedirectError);
  });
});

describe("no number, no API text and no logging in any response that is not the redirect to WhatsApp", () => {
  const spies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m as "log").mockImplementation(() => undefined));
  const failures: [string, () => void][] = [
    ["message read fails", () => getOutboxMessage.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["gate read fails", () => fetchLeadFollowup.mockRejectedValue(new ApiRequestError(500, "boom", `x ${CANARY} ${PHONE}`))],
    ["phone read fails", () => fetchContactPhone.mockRejectedValue(new Error(`x ${CANARY} ${PHONE}`))],
    ["gate word is new", () => fetchLeadFollowup.mockResolvedValue({ channel: "whatsapp", gate: { blocked: `${CANARY} ${PHONE}`, stopped: null, policy_in_force: true }, channels: [] })],
    ["number is not usable", () => fetchContactPhone.mockResolvedValue(`${PHONE} ${CANARY}`)],
  ];

  it.each(failures)("%s", async (_name, arrange) => {
    arrange();
    const res = await call();
    const everything = `${JSON.stringify([...res.headers.entries()])}${await res.text()}`;
    for (const bad of [CANARY, PHONE, PHONE.replace(/\s/g, ""), DIGITS, "wa.me"]) expect(everything).not.toContain(bad);
    const location = res.headers.get("Location");
    if (location !== null) {
      const code = new URL(location, "http://localhost").searchParams.get("whatsapp");
      expect(location).toBe(BACK(String(code)));
      expect((WHATSAPP_CODES as readonly string[]).includes(String(code))).toBe(true);
    } else expect(res.status).toBe(503);
  });

  it("nothing is logged on any path", async () => {
    await call();
    fetchContactPhone.mockRejectedValue(new Error(CANARY));
    await call();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
