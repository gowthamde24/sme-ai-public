import { describe, expect, it } from "vitest";

import { sendsOnEnter } from "./composer-keys";

const key = (over: Partial<{ key: string; shiftKey: boolean; keyCode: number; isComposing: boolean }> = {}) => ({ key: "Enter", shiftKey: false, keyCode: 13, nativeEvent: { isComposing: over.isComposing ?? false }, ...over });

describe("the composer's Enter key", () => {
  it("sends on a computer, but not with Shift, not while composing, not on a touch screen", () => {
    expect(sendsOnEnter(key(), false)).toBe(true);
    expect(sendsOnEnter(key({ shiftKey: true }), false)).toBe(false);
    expect(sendsOnEnter(key({ isComposing: true }), false)).toBe(false);
    expect(sendsOnEnter(key({ keyCode: 229 }), false)).toBe(false);
    expect(sendsOnEnter(key(), true)).toBe(false);
    expect(sendsOnEnter(key({ key: "a" }), false)).toBe(false);
  });
});
