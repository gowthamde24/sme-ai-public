import { describe, expect, it } from "vitest";

import * as ui from "@/components/v2/auth/ui";

const LEGACY = ["shell", "card", "error", "hint", "row", "secondary", "tabs", "tap", "badge"];

describe("auth class strings", () => {
  it("are plain non-empty strings with no legacy class name", () => {
    for (const [name, value] of Object.entries(ui)) {
      expect(typeof value, name).toBe("string");
      expect((value as string).trim().length, name).toBeGreaterThan(0);
      const tokens = (value as string).split(/\s+/);
      for (const bad of LEGACY) expect(tokens, `${name} uses the legacy class "${bad}"`).not.toContain(bad);
    }
  });
  it("never set an inline style", () => {
    for (const value of Object.values(ui)) expect(value as string).not.toMatch(/style=/);
  });
});
