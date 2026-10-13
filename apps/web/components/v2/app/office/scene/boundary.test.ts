import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/api/today";

import { ALL_AGENT_IDS, TEAM_IDS } from "./ids";
import { OWL_PALETTE } from "../../owl/owl-colors";
import { SEATS } from "./seats";

const WEB = path.resolve(import.meta.dirname, "../../../../..");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const rel = (f: string) => path.relative(WEB, f).split(path.sep).join("/");
const source = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f);

describe("the seven helpers", () => {
  it("are the API's seven, in the API's order (the scene keeps its own list so its chunk never imports the API client)", () => {
    expect([...ALL_AGENT_IDS]).toEqual([...AGENT_KEYS]);
    expect(ALL_AGENT_IDS[0]).toBe("main");
    expect(TEAM_IDS).toHaveLength(6);
  });
  it("each has a seat and an owl colour, and nobody else", () => {
    expect(Object.keys(SEATS).sort()).toEqual([...AGENT_KEYS].sort());
    expect(Object.keys(OWL_PALETTE).sort()).toEqual([...AGENT_KEYS].sort());
  });
});

describe("three.js stays in its own chunks", () => {
  const files = walk(WEB).filter(source);
  const importsThree = (f: string) => /from\s+["'](three|three\/|@react-three\/)/.test(fs.readFileSync(f, "utf8"));
  it("only the Office scene's own files import it (the Agent OWL is the plush owlet: plain DOM, CSS and a canvas; job CI)", () => {
    const found = files.filter(importsThree).map(rel).sort();
    expect(found.every((f) => f.startsWith("components/v2/app/office/scene/")), found.join(", ")).toBe(true);
    expect(found).toContain("components/v2/app/office/scene/Office3D.tsx");
    expect(found).toContain("components/v2/app/office/scene/owl-model.ts");
  });
  it("nothing in the owl folder imports three or the office scene, and the rest of the app reaches the scene only through next/dynamic (never a static import of Office3D or owl-model)", () => {
    const owlFiles = files.filter((f) => f.includes("/components/v2/app/owl/"));
    expect(owlFiles.length).toBeGreaterThan(3);
    for (const f of owlFiles) expect(fs.readFileSync(f, "utf8"), rel(f)).not.toMatch(/from\s+["'](three|@react-three\/|[^"']*\/office\/)/);
    const heavy = /from\s+["'][^"']*\/(scene\/Office3D|scene\/owl-model|owl-model)["']/;
    const bad = files.filter((f) => !f.includes("/office/scene/")).filter((f) => heavy.test(fs.readFileSync(f, "utf8").replace(/import type[^;]*;/g, "")));
    expect(bad.map((f) => path.relative(WEB, f))).toEqual([]);
    const stage = fs.readFileSync(path.join(WEB, "components/v2/app/office/OfficeStage.tsx"), "utf8");
    expect(stage).toMatch(/dynamic\(\(\) => import\("\.\/scene\/Office3D"\), \{\s*ssr: false/);
  });
});

describe("no human figures", () => {
  it("no skin tone, hair or person drawing is left in the web app's source", () => {
    const bad = walk(WEB)
      .filter(source)
      .filter((f) => /\b(skin|hairStyle|beard)\s*[:=]/.test(fs.readFileSync(f, "utf8")))
      .map(rel);
    expect(bad).toEqual([]);
  });
});
