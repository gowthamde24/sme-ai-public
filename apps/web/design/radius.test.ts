import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GROUP, problems } from "../scripts/radius-rules.mjs";

/**
 * Corners (owner, 26 Nov 2026, measured from Meta's console): panels and cards 8 px, buttons / inputs / menus / chips 6 px, tags 4 px. Round only avatars, status dots, the orb, switches, icon circles and thin bars.
 * This fails on a NEW rounded-2xl / rounded-3xl / rounded-[Npx] above 8 px, a pill-shaped (rounded-full) button or chip with text padding, or a CSS border-radius above 8 px outside the round shapes below.
 */
const WEB = path.join(import.meta.dirname, "..");
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

describe("corners", () => {
  it("no class group in the app or the public site has a card corner above 8 px or a pill-shaped button or chip", () => {
    const bad: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const f of walk(path.join(WEB, dir))) {
        if (!/\.tsx?$/.test(f) || /(?:\.test\.|\.d\.ts$)/.test(f)) continue;
        for (const g of fs.readFileSync(f, "utf8").match(GROUP) ?? []) for (const p of problems(g)) bad.push(`${path.relative(WEB, f)}: ${p.token} -> ${p.to}   (${g.trim().slice(0, 70)})`);
      }
    }
    expect(bad).toEqual([]);
  });

  // a CSS rule may be round (50%, a pill) only for these shapes: avatars, dots, rings, the orb, switches and knobs, bars and tracks, thumbs, ticks, spinners; or a box whose width and height are the same
  const ROUND = /avatar|\bav\b|mini-av|dot|orb|knob|switch|\bsw\b|ring|bar|progress|track|thumb|tick|spinner|swatch|pulse|radar|pin|hub-core|play-btn|skeleton|wave|brand-bars|-fill|\bi\b|\bspan\b/i;
  it("no CSS border-radius above 8 px except round shapes", () => {
    const bad: string[] = [];
    for (const f of [...walk(path.join(WEB, "design")).filter((x) => x.endsWith(".css")), path.join(WEB, "app/globals.css")]) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
        for (const r of m[2].matchAll(/border-radius:\s*([^;}!]+)/g)) {
          const vals = r[1].trim().split(/\s+/);
          const px = vals.map((v) => { const n = /^([\d.]+)(px|rem|em)$/.exec(v); return n ? Number(n[1]) * (n[2] === "px" ? 1 : 16) : 0; });
          if (px.every((n) => n <= 8)) continue;
          const w = /(?:^|[;\s])width:\s*([\w.]+)/.exec(m[2]), h = /(?:^|[;\s])height:\s*([\w.]+)/.exec(m[2]);
          if ((w && h && w[1] === h[1]) || /aspect-ratio:\s*1\b/.test(m[2]) || ROUND.test(sel)) continue;
          bad.push(`${path.relative(WEB, f)}: ${sel.slice(0, 70)} { border-radius: ${r[1].trim()} }`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
