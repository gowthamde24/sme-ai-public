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

describe("the production web flags (owner, 25 Nov 2026: Customer Zero sees the real app, never a test version)", () => {
  const prod = flags("production-web-flags.env");
  const staging = flags("staging-web-flags.env");
  it("every value is the real API (`1`): no `mock`, no list of workspace ids, no `0`", () => {
    // the one value that is not `1`: the PUBLIC Cloudflare Turnstile site key of the check box (release 2; the API's matching secret is in Secret Manager, never here)
    for (const [k, v] of Object.entries(prod)) if (k === "TURNSTILE_SITE_KEY") expect(v, k).toMatch(/^0x4[A-Za-z0-9_-]{15,40}$/); else expect(v, k).toBe("1");
    expect(JSON.stringify(prod)).not.toMatch(/mock|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  it("never has a staging-only, demo, test-call, staff, developer, offer or draft-legal flag", () => {
    for (const k of ["PREVIEW_JOBS", "DEMO_CALL", "GUIDED_DEMO", "TEST_CALL_TONE", "STAFF_CONSOLE", "DEVELOPER_KEYS_SCREENS", "OFFER_SCREENS", "LEGAL_DRAFT_PAGES", "ASSISTANT_WORK_TENANTS", "WAITLIST", "RAZORPAY_CHECKOUT", "BILLING_V2", "AUTO_REPLY_SCREENS", "SWEEP_SCREENS", "OWNER_TALK_PREFS"]) expect(Object.keys(prod), k).not.toContain(k);
  });
  it("may have the 'Do it' bar for every workspace (ASSISTANT_WORK_SCREENS=1, owner, 29 Nov 2026) but never a list of workspaces for it, and the Tell and industry-page flags, when set, are the real thing (`1`, never `mock`) and exist on staging too", () => {
    expect(prod.ASSISTANT_WORK_TENANTS, "no list of workspace ids in production: unset means every workspace").toBeUndefined();
    for (const k of ["ASSISTANT_WORK_SCREENS", "TELL_SCREENS", "INDUSTRY_PAGES"]) if (k in prod) { expect(prod[k], k).toBe("1"); expect(staging, k).toHaveProperty(k); }
  });
  it("has TEST_CALL_SCREENS (29 Nov 2026): outbound calling is on in production in sandbox mode, so the owner's \"Place a test call\" is the way to ring the sandbox list; the web sends only an id from the API's list and the API's gate refuses any number off that list", () => {
    expect(prod.TEST_CALL_SCREENS).toBe("1");
    expect(prod, "the Tone choice waits for its own decision").not.toHaveProperty("TEST_CALL_TONE");
  });
  it("is free early access with the new look, and every flag it sets is also set on staging (staging stays the reference)", () => {
    expect(prod.EARLY_ACCESS).toBe("1");
    for (const k of ["DESIGN_V6", "APP_V4", "TODAY_V5", "JOBS", "PHONE_NUMBER_SCREENS"]) expect(prod[k], k).toBe("1");
    for (const k of Object.keys(prod)) if (!["EARLY_ACCESS", "REVIEWED_TRANSLATIONS_ONLY"].includes(k)) expect(staging, k).toHaveProperty(k);
  });
});

describe("the declared snapshot of the production web service (deploy/settings/production/web.env)", () => {
  it("has every flag of production-web-flags.env with the same value, so the next deploy's drift check needs no allowance (29 Nov 2026: TEST_CALL_SCREENS was live but missing)", () => {
    const declared = flags("production-web-flags.env");
    const snapshot = flags("settings/production/web.env");
    for (const [k, v] of Object.entries(declared)) expect(snapshot[k], `${k} is missing from settings/production/web.env`).toBe(v);
  });
});
