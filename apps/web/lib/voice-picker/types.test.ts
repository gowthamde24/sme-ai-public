import { describe, expect, it } from "vitest";

import { pickerOrder } from "./types";

describe("pickerOrder", () => {
  it("lists every supported language, the workspace's own first", () => {
    expect(pickerOrder(["kn", "en"])).toEqual(["en", "kn", "te", "hi", "ta", "ml"]);
    expect(pickerOrder([])).toEqual(["te", "en", "hi", "kn", "ta", "ml"]);
    expect(pickerOrder(["xx"]).length).toBe(6);
  });
});
