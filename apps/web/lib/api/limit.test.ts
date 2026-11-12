// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireRead } from "./limit";

describe("at most a few reads at once for one person (C1's Phase 1)", () => {
  beforeEach(() => vi.stubEnv("API_READS_PER_USER", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("the ninth read waits until one of the first eight is done, and nothing is dropped", async () => {
    const releases: Array<() => void> = [];
    for (let i = 0; i < 8; i += 1) releases.push(await acquireRead("tok-a", "GET"));
    let ninth = false;
    const p = acquireRead("tok-a", "GET").then((r) => ((ninth = true), r));
    await Promise.resolve();
    expect(ninth).toBe(false);
    releases[0]();
    const r9 = await p;
    expect(ninth).toBe(true);
    r9();
    releases.slice(1).forEach((r) => r());
  });
  it("waiting reads go out in the order they were asked", async () => {
    vi.stubEnv("API_READS_PER_USER", "1");
    const first = await acquireRead("tok-b", "GET");
    const order: number[] = [];
    const waits = [1, 2, 3].map((n) => acquireRead("tok-b", "GET").then((r) => (order.push(n), r)));
    first();
    for (const w of waits) (await w)();
    expect(order).toEqual([1, 2, 3]);
  });
  it("another person is not held up, and a save is never made to wait", async () => {
    vi.stubEnv("API_READS_PER_USER", "1");
    const a = await acquireRead("tok-c", "GET");
    const other = await acquireRead("tok-d", "GET"); // a different person: straight through
    const write = await acquireRead("tok-c", "POST"); // a write: straight through
    a();
    other();
    write();
  });
  it("releasing twice does not free a second slot, and the person's lane is forgotten when idle", async () => {
    vi.stubEnv("API_READS_PER_USER", "1");
    const r = await acquireRead("tok-e", "GET");
    r();
    r();
    const again = await acquireRead("tok-e", "GET");
    let second = false;
    const p = acquireRead("tok-e", "GET").then(() => (second = true));
    await Promise.resolve();
    expect(second).toBe(false); // one slot, held by `again`
    again();
    await p;
  });
});
