import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.hoisted(() => ({ mode: "mock" as "mock" | "1" | "off" }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), kycPerClient: () => flag.mode }));

import { lookupPin, parsePostal } from "./pincode";
import { stateFromPostal } from "./rules";

beforeEach(() => {
  flag.mode = "mock";
});
afterEach(() => vi.unstubAllGlobals());

const GOOD = [{ Message: "Number of pincode(s) found:2", Status: "Success", PostOffice: [{ Name: "Anantapur H.O", District: "Ananthapuramu", State: "Andhra Pradesh" }, { Name: "x", District: "Other", State: "Andhra Pradesh" }] }];

describe("the PIN code lookup of the verification form", () => {
  it("reads the district of the first post office as the city and the state as one of ours", () => {
    expect(parsePostal(GOOD)).toEqual({ state: "Andhra Pradesh", city: "Ananthapuramu" });
    expect(parsePostal([{ Status: "Error", PostOffice: null }])).toBeNull();
    expect(parsePostal({})).toBeNull();
    expect(stateFromPostal("Jammu & Kashmir")).toBe("Jammu and Kashmir");
    expect(stateFromPostal("NCT of Delhi")).toBe("Delhi");
    expect(stateFromPostal("Atlantis")).toBeNull();
  });
  it("the test screen uses a small table and never asks the network", async () => {
    const net = vi.fn();
    vi.stubGlobal("fetch", net);
    expect(await lookupPin("515001")).toEqual({ state: "Andhra Pradesh", city: "Ananthapuramu" });
    expect(await lookupPin("999999")).toBeNull();
    expect(net).not.toHaveBeenCalled();
  });
  it("live: only the PIN goes to the India Post directory; a slow or broken answer is null; a bad PIN is never sent", async () => {
    flag.mode = "1";
    const net = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(GOOD) }));
    vi.stubGlobal("fetch", net);
    expect(await lookupPin("515001")).toEqual({ state: "Andhra Pradesh", city: "Ananthapuramu" });
    expect(net).toHaveBeenCalledTimes(1);
    expect(String((net.mock.calls[0] as unknown as [URL, RequestInit])[0])).toBe("https://api.postalpincode.in/pincode/515001");
    expect((net.mock.calls[0] as unknown as [URL, RequestInit])[1]).toMatchObject({ redirect: "error" }); // never follows a redirect elsewhere
    expect((net.mock.calls[0] as unknown as [URL, RequestInit])[1]).not.toHaveProperty("body");
    expect(await lookupPin("012345")).toBeNull();
    expect(net).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("slow"); }));
    expect(await lookupPin("515001")).toBeNull();
  });
  it("anything that is not exactly six digits (letters, a path, a host, a query, a space trick) never reaches fetch", async () => {
    flag.mode = "1";
    const net = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(GOOD) }));
    vi.stubGlobal("fetch", net);
    for (const bad of ["../etc/passwd", "515001/../x", "515001?x=1", "515001#a", "515001@evil.test", "//evil.test/515001", "51500a", "5150012", "051500", "٥١٥٠٠١", "515 001", "", "https://evil.test/515001", 515001, null, undefined, { toString: () => "515001" }]) expect(await lookupPin(bad), String(bad)).toBeNull();
    expect(net).not.toHaveBeenCalled();
  });
  it("an answer that is too big, or not JSON, is dropped", async () => {
    flag.mode = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => " ".repeat(30_000) + JSON.stringify(GOOD) })));
    expect(await lookupPin("515001")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "<html>" })));
    expect(await lookupPin("515001")).toBeNull();
  });
});
