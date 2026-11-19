import { beforeEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";

const h = vi.hoisted(() => ({ who: vi.fn(), add: vi.fn(), remove: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidate(p) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("../retailers/finder-guard", async (orig) => ({ ...(await orig<typeof import("../retailers/finder-guard")>()), who: (...a: unknown[]) => h.who(...a) }));
vi.mock("@/lib/api/do-not-call", () => ({ addDnc: (...a: unknown[]) => h.add(...a), removeDnc: (...a: unknown[]) => h.remove(...a) }));

import { addDncAction, removeDncAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const E = "77777777-7777-4777-8777-777777777701";
const t = appT("en");
const entry = { id: E, phoneMasked: "+91 98480 ••• 21", reason: "added_by_owner" as const, at: "2026-11-19T04:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  h.who.mockResolvedValue({ token: "tok", t });
});

describe("Do-Not-Call actions", () => {
  it("add: Owner and Admin only (the guard is asked with them), the number is checked first, then sent and the page is refreshed", async () => {
    h.add.mockResolvedValue(entry);
    const r = await addDncAction(T, "98480 12321");
    expect(h.who).toHaveBeenCalledWith(T, ["owner", "admin"]);
    expect(h.add).toHaveBeenCalledWith("tok", T, "98480 12321");
    expect(h.revalidate).toHaveBeenCalledWith(`/app/tenants/${T}/do-not-call`);
    expect(r).toEqual({ ok: true, data: entry });
  });
  it("add: a number that is not an Indian mobile is refused in words and never reaches the API", async () => {
    const r = await addDncAction(T, "12345");
    expect(r).toMatchObject({ ok: false, kind: "invalid", error: "Please type a 10-digit Indian mobile number." });
    expect(h.add).not.toHaveBeenCalled();
  });
  it("add: someone the guard refuses (a Sales member) gets the guard's refusal and nothing is sent", async () => {
    h.who.mockResolvedValue({ ok: false, kind: "forbidden", error: "no" });
    expect(await addDncAction(T, "98480 12321")).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.add).not.toHaveBeenCalled();
  });
  it("remove: the OWNER only, a real id, then sent and the page is refreshed", async () => {
    h.remove.mockResolvedValue(undefined);
    const r = await removeDncAction(T, E);
    expect(h.who).toHaveBeenCalledWith(T, ["owner"]);
    expect(h.remove).toHaveBeenCalledWith("tok", T, E);
    expect(r).toEqual({ ok: true, data: { id: E } });
    expect(await removeDncAction(T, "../x")).toMatchObject({ ok: false, kind: "invalid" });
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
  it("remove: an Admin is refused by the guard", async () => {
    h.who.mockResolvedValue({ ok: false, kind: "forbidden", error: "no" });
    expect(await removeDncAction(T, E)).toMatchObject({ ok: false, kind: "forbidden" });
    expect(h.remove).not.toHaveBeenCalled();
  });
});
