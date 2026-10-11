import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEW_LOCAL } from "./setup-logic";
import { readLocal, resetSetupStore, subscribeLocal, writeLocal } from "./setup-store";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  window.localStorage.clear();
  resetSetupStore();
});
afterEach(() => vi.restoreAllMocks());

describe("this device's memory of the setup (job BJ)", () => {
  it("starts new, remembers a change per workspace, and keeps it across a reload", () => {
    expect(readLocal(A)).toEqual(NEW_LOCAL);
    writeLocal(A, { step: 2, hoursDone: true });
    expect(readLocal(A)).toMatchObject({ step: 2, hoursDone: true, state: "new" });
    expect(readLocal(B)).toEqual(NEW_LOCAL);
    resetSetupStore(); // a reload: the memory is read from the browser again
    expect(readLocal(A)).toMatchObject({ step: 2, hoursDone: true });
  });
  it("reads the same object until it changes (so a React store can use it), and tells subscribers", () => {
    const seen = vi.fn();
    const off = subscribeLocal(seen);
    expect(readLocal(A)).toBe(readLocal(A));
    writeLocal(A, { state: "skipped" });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    writeLocal(A, { state: "dismissed" });
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it("ignores anything stored that is not ours: bad JSON, a wrong state, a step out of range", () => {
    window.localStorage.setItem(`sme.setup.v1.${A}`, "{not json");
    expect(readLocal(A)).toEqual(NEW_LOCAL);
    resetSetupStore();
    window.localStorage.setItem(`sme.setup.v1.${A}`, JSON.stringify({ state: "hacked", step: 99, agentSeen: "yes" }));
    expect(readLocal(A)).toEqual(NEW_LOCAL);
  });
  it("works when the browser will not store anything (kept in memory for the page)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLocal(A)).toEqual(NEW_LOCAL);
    writeLocal(A, { step: 3 });
    expect(readLocal(A).step).toBe(3);
  });
  it("another tab's change is read again", () => {
    writeLocal(A, { step: 1 });
    window.localStorage.setItem(`sme.setup.v1.${A}`, JSON.stringify({ ...NEW_LOCAL, step: 3 }));
    const seen = vi.fn();
    const off = subscribeLocal(seen);
    window.dispatchEvent(new StorageEvent("storage", { key: `sme.setup.v1.${A}` }));
    expect(seen).toHaveBeenCalled();
    expect(readLocal(A).step).toBe(3);
    off();
  });
});
