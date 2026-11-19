import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DEPLOY = path.resolve(__dirname, "../../../../deploy");
const flags = (file: string): Record<string, string> =>
  Object.fromEntries(
    fs
      .readFileSync(path.join(DEPLOY, file), "utf8")
      .split("\n")
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

describe("PREVIEW_JOBS in the deploy files", () => {
  it("is on for staging and absent from production (the production build ignores the preview cookie)", () => {
    expect(flags("staging-web-flags.env").PREVIEW_JOBS).toBe("1");
    expect(Object.keys(flags("production-web-flags.env"))).not.toContain("PREVIEW_JOBS");
    expect(fs.readFileSync(path.join(DEPLOY, "production-web-flags.env"), "utf8").replace(/^#.*$/gm, "")).not.toMatch(/PREVIEW_JOBS/);
  });
});
