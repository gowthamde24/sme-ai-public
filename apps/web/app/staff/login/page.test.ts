import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import StaffLoginPage from "./page";

describe("/staff/login", () => {
  it("a signed-in visitor goes on to the console", () => {
    expect(() => StaffLoginPage()).toThrow("REDIRECT /staff");
    expect(redirect).toHaveBeenCalledWith("/staff");
  });
});
