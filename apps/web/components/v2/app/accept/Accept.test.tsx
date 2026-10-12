import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import type { PolicyStatus } from "@/lib/api/policy";

import { AcceptForm } from "./AcceptForm";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const WORDS = wordsFor("en", ["acpt.", "apierr.", "problem."], ["dta.btn.working"]);
const status = (needs: { terms: boolean; privacy: boolean }): PolicyStatus => ({ current: { terms: { version: "2026-11-01", effective_from: "2026-11-10" }, privacy: { version: "2026-10-01", effective_from: null } }, accepted: [], needs, blocking: true });
const ok = { ok: true as const, data: status({ terms: false, privacy: false }) };
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("accepting a changed policy", () => {
  it("shows only what changed, with its version, a link to read it in a new tab, and a box nobody ticked for the person", () => {
    render(<AcceptForm words={WORDS} status={status({ terms: true, privacy: false })} accept={vi.fn()} next="/app" />);
    expect(screen.getByText("Terms of use")).toBeInTheDocument();
    expect(screen.queryByText("Privacy Policy")).toBeNull();
    expect(screen.getByText(/Version 2026-11-01/)).toBeInTheDocument();
    expect(screen.getByText(/in force from 2026-11-10/)).toBeInTheDocument();
    const read = screen.getByRole("link", { name: /Read the Terms/ });
    expect(read).toHaveAttribute("href", "/terms");
    expect(read).toHaveAttribute("target", "_blank");
    expect(read).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("checkbox", { name: "I have read the Terms and I agree." })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled();
  });
  it("sends the versions that were shown once every box is ticked, then goes where the person was going", async () => {
    const accept = vi.fn(async () => ok);
    render(<AcceptForm words={WORDS} status={status({ terms: true, privacy: true })} accept={accept} next="/app/tenants/x" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Terms/ }));
    expect(screen.getByRole("button", { name: "Accept and continue" })).toBeDisabled(); // the Privacy Policy is not ticked yet
    fireEvent.click(screen.getByRole("checkbox", { name: /Privacy Policy/ }));
    await press("Accept and continue");
    expect(accept).toHaveBeenCalledWith({ terms: "2026-11-01", privacy: "2026-10-01" });
    expect(replace).toHaveBeenCalledWith("/app/tenants/x");
  });
  it("a version changed while the page was open is said, with a way to reload", async () => {
    const accept = vi.fn(async () => ({ ok: false as const, kind: "conflict" as const, error: "", code: "policy_version_outdated" }));
    render(<AcceptForm words={WORDS} status={status({ terms: true, privacy: false })} accept={accept} next="/app" />);
    fireEvent.click(screen.getByRole("checkbox"));
    await press("Accept and continue");
    expect(screen.getByRole("alert")).toHaveTextContent("changed again while this page was open");
    await press("Reload the page");
    expect(refresh).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
  it("when nothing needs accepting it says so and offers to continue", () => {
    render(<AcceptForm words={WORDS} status={status({ terms: false, privacy: false })} accept={vi.fn()} next="/app" />);
    expect(screen.getByRole("status")).toHaveTextContent("You are up to date.");
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/app");
  });
});
