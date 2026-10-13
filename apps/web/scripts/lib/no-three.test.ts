// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { THREE_IMPORT, findThree } from "./no-three.mjs";

const WEB = path.resolve(import.meta.dirname, "../..");

describe("three.js is gone from the app (job CJ)", () => {
  it("nothing in apps/web imports it, lists it as a dependency, locks it, or budgets for it", () => {
    expect(findThree(WEB)).toEqual([]);
  });
  it("the pattern catches every way of importing it, and not words that only contain 'three'", () => {
    for (const s of ['import * as THREE from "three";', "import { Canvas } from '@react-three/fiber';", 'const t = await import("three/examples/jsm/controls/OrbitControls.js");', 'const t = require("three");', 'import "three";', 'import type { Mesh } from "@types/three";'])
      expect(THREE_IMPORT.test(s), s).toBe(true);
    for (const s of ['const x = "three";', 'import { x } from "./three-things";', 'import { y } from "lucide-react";', "// from three owls"]) expect(THREE_IMPORT.test(s), s).toBe(false);
  });
  it("fails on a folder that still has it (the rule itself works)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "no-three-"));
    try {
      fs.mkdirSync(path.join(dir, "scripts"));
      fs.writeFileSync(path.join(dir, "scripts/budget.json"), JSON.stringify({ office3d: { maxGzipBytes: 1 } }));
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { three: "1.0.0" } }));
      fs.writeFileSync(path.join(dir, "scene.tsx"), 'import * as THREE from "three";\n');
      const found = findThree(dir);
      expect(found).toEqual(expect.arrayContaining(["scene.tsx imports three.js", "package.json dependencies still has three", "scripts/budget.json still has an office3d or agentOwl budget"]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
