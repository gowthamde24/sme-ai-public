import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_KEYS } from "@/lib/api/today";

import { ALL_AGENT_IDS, TEAM_IDS } from "./ids";
import { PEOPLE } from "./people";
import { SEATS } from "./seats";

const WEB = path.resolve(import.meta.dirname, "../../../../..");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
const source = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f);

describe("the seven helpers", () => {
  it("are the API's seven, in the API's order (the scene keeps its own list so its chunk never imports the API client)", () => {
    expect([...ALL_AGENT_IDS]).toEqual([...AGENT_KEYS]);
    expect(ALL_AGENT_IDS[0]).toBe("main");
    expect(TEAM_IDS).toHaveLength(6);
  });
  it("each has a seat and a person drawn for it, and nobody else", () => {
    expect(Object.keys(SEATS).sort()).toEqual([...AGENT_KEYS].sort());
    expect(Object.keys(PEOPLE).sort()).toEqual([...AGENT_KEYS].sort());
  });
});

describe("three.js stays in its own chunk", () => {
  const files = walk(WEB).filter(source);
  const importsThree = (f: string) => /from\s+["'](three|three\/|@react-three\/)/.test(fs.readFileSync(f, "utf8"));
  it("only the scene files import it", () => {
    const rel = files.filter(importsThree).map((f) => path.relative(WEB, f).split(path.sep).join("/")).sort();
    expect(rel.every((f) => f.startsWith("components/v2/app/office/scene/")), rel.join(", ")).toBe(true);
    expect(rel).toContain("components/v2/app/office/scene/Office3D.tsx");
  });
  it("and the rest of the app reaches the scene only through next/dynamic (never a static import of Office3D, character, geo or anatomy)", () => {
    const heavy = /from\s+["'][^"']*\/scene\/(Office3D|character|geo|anatomy|people)["']/;
    const bad = files.filter((f) => !f.includes("/office/scene/")).filter((f) => heavy.test(fs.readFileSync(f, "utf8").replace(/import type[^;]*;/g, "")));
    expect(bad.map((f) => path.relative(WEB, f))).toEqual([]);
    const stage = fs.readFileSync(path.join(WEB, "components/v2/app/office/OfficeStage.tsx"), "utf8");
    expect(stage).toMatch(/dynamic\(\(\) => import\("\.\/scene\/Office3D"\), \{\s*ssr: false/);
  });
});
