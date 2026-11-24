import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { KycOptions, KycState, KycStatus } from "@/lib/phone-kyc/types";

import { KycCard } from "./KycCard";

vi.mock("../ds/LazyFileField", async () => ({ LazyFileField: (await import("../ds/FileField")).FileField }));
afterEach(cleanup);
const WORDS = appDict("en") as Record<string, string>;
const status = (state: KycState): KycStatus => ({ state, kycId: null, docKind: null, complianceId: null, reason: null, createdAt: null, updatedAt: null, checkedAt: null, live: true, canChoose: true } as unknown as KycStatus);
const OPTIONS: KycOptions = { live: true, documents: [{ kind: "gst", numberLabel: "GSTIN", numberExample: "36ABCDE1234F1Z5" }], maxFileBytes: 5_000_000, fileTypes: ["application/pdf"], keptNote: "" };
const draw = (state: KycState) => render(<KycCard steps words={WORDS} status={status(state)} options={OPTIONS} canEdit endpoint="/x" />);
const states = () => [...document.querySelectorAll("[data-step]")].map((e) => e.getAttribute("data-state"));

describe("Phone numbers as three steps (PHONE_STEPS)", () => {
  it("not registered yet: step 1 is open with the form under it, 2 and 3 are one grey line each; no card, no status pill", () => {
    draw("not_started");
    expect(states()).toEqual(["current", "todo", "todo"]);
    expect(document.querySelector('[data-part="kyc-form"]')).not.toBeNull();
    expect(document.querySelector('[data-part="phone-kyc-card"]')?.className).not.toMatch(/rounded|border/);
    expect(document.body.textContent).not.toMatch(/Not registered yet/);
  });
  it("a refusal is still said in words (the state sentence), not only by the step", () => {
    draw("rejected");
    expect(document.body.textContent).toMatch(/did not accept it/);
  });
  it("while the phone company checks, steps 1 and 2 are done and step 3 is current; accepted = all done", () => {
    draw("submitted");
    expect(states()).toEqual(["done", "done", "current"]);
    cleanup();
    draw("accepted");
    expect(states()).toEqual(["done", "done", "done"]);
  });
});
