import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import StaffLoginPage from "./page";

describe("/staff/login", () => {
  it("sends staff to the normal sign-in and back to the console", () => {
    expect(() => StaffLoginPage()).toThrow("REDIRECT /login?next=%2Fstaff");
    expect(redirect).toHaveBeenCalledWith("/login?next=%2Fstaff");
  });
});
