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
  it("only the Office scene and the owl's 3D files import it", () => {
    const found = files.filter(importsThree).map(rel).sort();
    expect(found.every((f) => f.startsWith("components/v2/app/office/scene/") || ["components/v2/app/owl/owl-model.ts", "components/v2/app/owl/AgentOwlScene.tsx"].includes(f)), found.join(", ")).toBe(true);
    expect(found).toContain("components/v2/app/office/scene/Office3D.tsx");
    expect(found).toContain("components/v2/app/owl/owl-model.ts");
    expect(found).toContain("components/v2/app/owl/AgentOwlScene.tsx");
  });
  it("and the rest of the app reaches them only through next/dynamic (never a static import of Office3D, owl-model or AgentOwlScene)", () => {
    const heavy = /from\s+["'][^"']*\/(scene\/Office3D|owl-model|AgentOwlScene)["']/;
    const bad = files.filter((f) => !f.includes("/office/scene/") && !/\/owl\/(owl-model|AgentOwlScene)\.tsx?$/.test(f)).filter((f) => heavy.test(fs.readFileSync(f, "utf8").replace(/import type[^;]*;/g, "")));
    expect(bad.map((f) => path.relative(WEB, f))).toEqual([]);
    const stage = fs.readFileSync(path.join(WEB, "components/v2/app/office/OfficeStage.tsx"), "utf8");
    expect(stage).toMatch(/dynamic\(\(\) => import\("\.\/scene\/Office3D"\), \{\s*ssr: false/);
    const owl = fs.readFileSync(path.join(WEB, "components/v2/app/owl/AgentOwl3D.tsx"), "utf8");
    expect(owl).toMatch(/dynamic\(\(\) => import\("\.\/AgentOwlScene"\), \{\s*ssr: false/);
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
