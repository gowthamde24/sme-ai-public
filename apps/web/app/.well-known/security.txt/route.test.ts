import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.useRealTimers());

describe("/.well-known/security.txt", () => {
  it("is plain text with a contact, an expiry a year ahead, the languages, the canonical address and the policy (the Security page)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
    const res = GET();
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const lines = (await res.text()).trim().split("\n");
    expect(lines).toEqual([
      "Contact: mailto:security@stack19.com",
      "Expires: 2027-10-28T00:00:00.000Z",
      "Preferred-Languages: en, te, hi, kn",
      "Canonical: https://stack19.com/.well-known/security.txt",
      "Policy: https://stack19.com/security",
    ]);
  });
});
