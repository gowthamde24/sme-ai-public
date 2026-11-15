import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PATH, RECORD_PATH } from "./registry";

const ROOT = join(__dirname, "../../app/app/tenants/[tenantId]");

describe("the addresses the assistant opens", () => {
  it("every page it can navigate to is a real page of the app (a wrong address was a 'Not found' for the owner)", () => {
    for (const [page, path] of Object.entries(PATH)) {
      expect(existsSync(join(ROOT, path, "page.tsx")), `${page} -> ${path || "/"}`).toBe(true);
    }
  });
  it("every record it can open is a real folder of the app", () => {
    for (const [type, path] of Object.entries(RECORD_PATH)) {
      expect(existsSync(join(ROOT, path)), `${type} -> ${path}`).toBe(true);
    }
  });
});
