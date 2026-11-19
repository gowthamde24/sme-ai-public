import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ mode: { v: "off" } }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/screens/flag", () => ({ jobsScreens: () => h.mode.v }));

import JobsLayout from "./layout";

describe("the Jobs layout (a true 404 while JOBS is off)", () => {
  beforeEach(() => {
    h.mode.v = "off";
  });
  it("answers not found before the page streams when JOBS is off", () => {
    expect(() => JobsLayout({ children: "x" })).toThrow("NEXT_NOT_FOUND");
  });
  it("lets the page through when JOBS is mock or on", () => {
    h.mode.v = "mock";
    expect(JobsLayout({ children: "x" })).toBe("x");
    h.mode.v = "on";
    expect(JobsLayout({ children: "x" })).toBe("x");
  });
});
