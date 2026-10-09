// @vitest-environment node
/** The theme bridge (workspace redesign, Batch 0): screens not yet in the v2 look follow the v2 theme button, in both directions, with the SAME colours the system-dark rules use. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");
const bridgeAt = css.indexOf("/* ---- Workspace redesign: theme bridge");
const bridge = css.slice(bridgeAt);
const legacy = css.slice(0, bridgeAt);
const MEDIA = /@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/g;
const darkMedia = (legacy.match(MEDIA) ?? []).join("\n");
const plain = legacy.replace(MEDIA, "");

/** selector -> declarations, for the flat rules of a stylesheet text (at-rule preludes are skipped; nested rules inside @media are found one level down). */
const rulesOf = (text: string) => {
  const out = new Map<string, Record<string, string>>();
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}@]+?)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    const body = Object.fromEntries([...m[2].matchAll(/([\w-]+):\s*([^;]+?)\s*(?:;|$)/g)].map((d) => [d[1], d[2]]));
    out.set(selector, { ...(out.get(selector) ?? {}), ...body });
  }
  return out;
};
const bridgeRules = rulesOf(bridge);
const mediaRules = rulesOf(darkMedia);
const plainRules = rulesOf(plain);

const BADGES = ["badge-priority", "badge-worth-reviewing", "badge-maybe", "badge-low-priority", "badge-hidden", "badge-good", "badge-bad", "factor-item"];

describe("the theme bridge", () => {
  it("exists once, at the end of globals.css, and is labelled for removal", () => {
    expect(css.match(/theme bridge/g)?.length).toBe(1);
    expect(bridge).toMatch(/Deleted with the last legacy screen/);
  });

  it("dark: the variables and every system-dark colour are repeated under html[data-theme=dark] with the same values", () => {
    expect(bridgeRules.get('html[data-theme="dark"]')).toMatchObject(mediaRules.get(":root") ?? { missing: "root" });
    for (const name of BADGES) expect(bridgeRules.get(`html[data-theme="dark"] .${name}`), name).toMatchObject(mediaRules.get(`.${name}`) ?? { missing: name });
    expect(bridgeRules.get('html[data-theme="dark"] .error')).toMatchObject(mediaRules.get(".error") ?? { missing: "error" });
  });

  it("light: the root variables and the plain colours are restored under html[data-theme=light], for a dark system with a light choice", () => {
    const root = plainRules.get(":root") ?? {};
    expect(bridgeRules.get('html[data-theme="light"]')).toMatchObject({ "--bg": root["--bg"], "--fg": root["--fg"], "--muted": root["--muted"], "--link": root["--link"], "--link-visited": root["--link-visited"] });
    for (const name of BADGES) {
      const base = plainRules.get(`.${name}`) ?? { missing: name };
      const wanted = Object.fromEntries(Object.entries(base).filter(([k]) => ["background", "color", "missing"].includes(k)));
      expect(bridgeRules.get(`html[data-theme="light"] .${name}`), name).toMatchObject(wanted);
    }
    expect(bridgeRules.get('html[data-theme="light"] .error')).toMatchObject({ color: plainRules.get(".error")?.color });
  });

  it("changes nothing when there is no choice: every selector of the bridge starts with html[data-theme=", () => {
    expect(bridgeRules.size).toBeGreaterThan(10);
    for (const selector of bridgeRules.keys()) expect(selector).toMatch(/^html\[data-theme="(dark|light)"\]/);
  });
});
