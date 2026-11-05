import { afterEach, describe, expect, it, vi } from "vitest";

import { getAgentSwitches, parseSwitch, putAgentSwitch } from "./agent-switches";

const T = "11111111-1111-4111-8111-111111111111";
const ITEM = { agent: "researcher", enabled: false, can_switch: true, reason_locked: null, done_today: 2 };
afterEach(() => vi.unstubAllGlobals());
const stub = (body: unknown) => {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("a switch per helper (C1's docs/contracts/agents-switches.md)", () => {
  it("reads each helper's switch, strictly", () => {
    expect(parseSwitch(ITEM)).toEqual({ agent: "researcher", enabled: false, canSwitch: true, reasonLocked: null, doneToday: 2 });
    expect(parseSwitch({ ...ITEM, agent: "quote_writer", can_switch: false, reason_locked: "not_built", done_today: null })).toMatchObject({ canSwitch: false, reasonLocked: "not_built", doneToday: null });
    for (const bad of [{ ...ITEM, agent: "boss" }, { ...ITEM, enabled: "no" }, { ...ITEM, reason_locked: "why" }, { ...ITEM, done_today: -1 }]) expect(() => parseSwitch(bad)).toThrow();
  });
  it("GET the list and PUT one switch with exactly {enabled}", async () => {
    const f = stub([ITEM]);
    expect(await getAgentSwitches("tok", T)).toHaveLength(1);
    stub(ITEM);
    await putAgentSwitch("tok", T, "researcher", true);
    const calls = [...f.mock.calls, ...(vi.mocked(fetch).mock.calls as unknown[])] as unknown as [string, RequestInit][];
    expect(String(calls[0][0])).toMatch(new RegExp(`/v1/tenants/${T}/agents/switches$`));
    const put = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit][])[0];
    expect(String(put[0])).toMatch(new RegExp(`/v1/tenants/${T}/agents/researcher/switch$`));
    expect(put[1].method).toBe("PUT");
    expect(JSON.parse(String(put[1].body))).toEqual({ enabled: true });
  });
});
