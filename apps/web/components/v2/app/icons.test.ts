import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAMES, SPRITE, versionOf } from "../../../scripts/nav-icons.mjs";

import { ICONS, SPRITE_VERSION } from "./icons";

const sprite = readFileSync(SPRITE as string, "utf8");

describe("the menu's icon sprite (public/icons/nav.svg)", () => {
  it("holds a symbol for every icon the menu draws, and every one the build script lists", () => {
    for (const id of new Set([...Object.values(ICONS), ...NAMES])) expect(sprite, id).toContain(`<symbol id="${id}" viewBox="0 0 24 24">`);
  });
  it("is addressed by its own hash, so a changed sprite is a new address (run node scripts/nav-icons.mjs and copy the version)", () => {
    expect(SPRITE_VERSION).toBe(versionOf(sprite));
  });
  it("is plain shapes: no script, no link, no style", () => {
    expect(sprite).not.toMatch(/<script|href=|<style|on[a-z]+=/i);
    expect(path.basename(SPRITE)).toBe("nav.svg");
  });
});
