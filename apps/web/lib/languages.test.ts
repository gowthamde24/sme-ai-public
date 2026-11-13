import { describe, expect, it } from "vitest";

import { CALL_LANGS } from "@/lib/assistant/types";

import { LAUNCH_LANGS, offeredLangs, withKept } from "./languages";

describe("the one language list", () => {
  it("is the four launch languages, in the order of the app's own language list", () => {
    expect(LAUNCH_LANGS).toEqual(["en", "te", "hi", "kn"]);
    expect(offeredLangs(false)).toEqual(["en", "te", "hi", "kn"]);
  });

  it("with the flag, the others follow and nothing is lost", () => {
    const all = offeredLangs(true);
    expect(all.slice(0, 4)).toEqual(["en", "te", "hi", "kn"]);
    expect([...all].sort()).toEqual([...CALL_LANGS].sort());
  });

  it("a language in use stays visible without the flag; an unknown word and a repeat add nothing", () => {
    expect(withKept(offeredLangs(false), "ta", "te", "xx", null, undefined)).toEqual(["en", "te", "hi", "kn", "ta"]);
    expect(withKept(offeredLangs(false))).toBe(offeredLangs(false));
    expect(withKept(offeredLangs(true), "ml")).toEqual(offeredLangs(true));
  });
});
