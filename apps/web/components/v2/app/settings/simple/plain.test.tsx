import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { wordsFor } from "@/i18n/app-words";
import { BUSINESS_LANGUAGES } from "@/lib/api/profile";
import type { Member } from "@/lib/api/team";

import type { TeamActions } from "../../team/team-types";
import { BusinessSimple } from "./BusinessSimple";
import { InviteSimple, TeamMembersSimple } from "./TeamSimple";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(cleanup);
const words = wordsFor("en", ["jobs.set.", "settings.biz.", "sv6.", "set.f.", "team.", "apierr."], ["catalogue.v6.publish", "dta.btn.working"]);

describe("Settings > Business without sentences (SETTINGS_OPEN)", () => {
  const draw = (action = vi.fn(async () => ({ ok: true as const }))) => {
    render(<BusinessSimple plain variant="page" words={words} action={action} name="Pavers Corner" town="Guntur" languages={["en", "te"]} choices={BUSINESS_LANGUAGES} canEdit />);
    return action;
  };
  it("plain labelled fields, no sentence with a blank, no What-it-will-do box", () => {
    draw();
    expect(screen.getByLabelText("Business name")).toHaveValue("Pavers Corner");
    expect(screen.getByLabelText("City or town")).toHaveValue("Guntur");
    expect(screen.queryByText(/My business is called/)).toBeNull();
    expect(document.querySelector("[data-part='effect']")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("Save wakes on a change, says 'You have unsaved changes.', sends the same fields, then says 'Saved.'", async () => {
    const action = draw();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Pavers Corner 2" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();
    await act(async () => void fireEvent.submit(screen.getByLabelText("Business name").closest("form")!));
    const fd = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(fd.get("name")).toBe("Pavers Corner 2");
    expect(fd.get("town")).toBe("Guntur");
    expect(fd.getAll("languages")).toEqual(["en", "te"]);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
  it("the last language cannot be switched off", () => {
    render(<BusinessSimple plain variant="page" words={words} action={vi.fn()} name="A" town="B" languages={["en"]} choices={BUSINESS_LANGUAGES} canEdit />);
    const english = screen.getByLabelText("English") as HTMLInputElement;
    fireEvent.click(english);
    expect(english.checked).toBe(true);
  });
});

describe("Team without sentences (SETTINGS_OPEN)", () => {
  const actions = { invite: vi.fn(async () => ({ ok: false as const, kind: "failed" as const, code: "x" })), changeRole: vi.fn(), remove: vi.fn() } as unknown as TeamActions;
  it("the invite is three plain fields and one button", () => {
    render(<InviteSimple plain words={words} myRole="owner" workspaceName="Shop" actions={actions} />);
    expect(screen.getByLabelText("Their job")).toBeInTheDocument();
    expect(screen.getByLabelText("Code works for")).toBeInTheDocument();
    expect(screen.getByLabelText("A note for yourself (optional)")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/Invite someone as/)).toBeNull();
  });
  it("a person is a name and a role field, not a sentence", () => {
    const m: Member = { user_id: "u2", display_name: "Ramesh", role: "sales", is_you: false, joined_at: null } as Member;
    render(<TeamMembersSimple plain words={words} members={[m]} myRole="owner" actions={actions} />);
    expect(screen.getByText("Ramesh")).toBeInTheDocument();
    expect(screen.getByLabelText(/Ramesh: Role/)).toBeInTheDocument();
    expect(screen.queryByText(/can work with customers/)).toBeNull();
  });
});

import { LanguageSimple } from "./LanguageSimple";

describe("Settings > Language without sentences (SETTINGS_OPEN)", () => {
  it("App language and Appearance are labelled fields, the assistant's languages are ticks, Save waits for a change", () => {
    const w = wordsFor("en", ["jobs.set.", "settings.biz.", "settings.language.", "set.f."]);
    render(<LanguageSimple plain bare words={w} lang="en" theme="system" assistant={{ name: "A", town: "B", languages: ["en"], choices: BUSINESS_LANGUAGES, save: vi.fn(async () => ({ ok: true as const })) }} />);
    expect(screen.getByLabelText("Language")).toBeInTheDocument();
    expect(screen.getByLabelText("Appearance")).toBeInTheDocument();
    expect(screen.getByLabelText("English")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.queryByText(/The app speaks/)).toBeNull();
  });
});
