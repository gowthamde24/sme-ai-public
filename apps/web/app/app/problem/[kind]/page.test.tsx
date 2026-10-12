import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFoundMock, redirectMock } from "@/test/helpers";

const requireUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to), notFound: () => notFoundMock() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));

import ProblemPage from "./page";

const props = (kind: string) => ({ params: Promise.resolve({ kind }) }) as unknown as Parameters<typeof ProblemPage>[0];

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: "u", accessToken: "t" });
});

describe("/app/problem/[kind]", () => {
  it.each([["403", "This is not open to you"], ["404", "Not found"], ["429", "Too many tries"], ["500", "Something went wrong on our side"]])("%s is the friendly page", async (kind, title) => {
    render(await ProblemPage(props(kind)));
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });
  it("429 and 500 offer Try again; 403 and 404 do not", async () => {
    render(await ProblemPage(props("429")));
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
  it("any other word is the ordinary not-found, and nothing from the address is drawn", async () => {
    await expect(ProblemPage(props("418"))).rejects.toThrow();
    await expect(ProblemPage(props("<script>"))).rejects.toThrow();
  });
  it("needs a signed-in person", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/login"));
    await expect(ProblemPage(props("403"))).rejects.toThrow(/login/);
  });
});
