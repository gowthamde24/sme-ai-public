import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parsePreview } from "@/lib/api/campaigns";
import { PREVIEW_ISSUES_JSON, PREVIEW_JSON, SHA } from "@/lib/api/campaigns-fixtures";

import { WORDS } from "../materials/mat-test-kit";
import { ApprovalPanel, type ApproveAction } from "./ApprovalPanel";

const preview = parsePreview(PREVIEW_JSON);
function show(over: Partial<React.ComponentProps<typeof ApprovalPanel>> = {}, approve?: ApproveAction) {
  const a = vi.fn<ApproveAction>(approve ?? (async () => ({ ok: true, planned: 54, past: 2, sendingOn: true })));
  render(<ApprovalPanel preview={preview} role="owner" status="draft" words={WORDS} approve={a} {...over} />);
  return a;
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Approve this campaign" }));
beforeEach(() => vi.clearAllMocks());

describe("reading the messages before approving", () => {
  it("shows every sample as the person will read it, with its labels, the total and the disclosure line", () => {
    show();
    expect(screen.getAllByText(/Hello .* \(synthetic\)/)).toHaveLength(3);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Longest")).toBeInTheDocument();
    expect(screen.getAllByText("₹4,12,500.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Reply STOP to stop messages/)).toBeInTheDocument();
  });
  it("approving asks first, needs the tick, and passes the hash of the samples that were shown", async () => {
    const a = show();
    open();
    const go = screen.getByRole("button", { name: "Approve" });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => void fireEvent.click(go));
    expect(a).toHaveBeenCalledWith(SHA);
    expect(screen.getByRole("status")).toHaveTextContent("54 message steps are planned");
    expect(screen.getByRole("status")).toHaveTextContent("2 steps were already in the past");
    expect(refresh).toHaveBeenCalled();
  });
  it("a second press while it works does nothing more", async () => {
    let release: (v: Awaited<ReturnType<ApproveAction>>) => void = () => undefined;
    const a = show({}, () => new Promise((r) => { release = r; }));
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    const go = screen.getByRole("button", { name: "Approve" });
    await act(async () => void fireEvent.click(go));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Working…" })));
    expect(a).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: true, planned: 1, past: 0, sendingOn: true }));
  });
  it("a missing second factor points at the Security page and keeps the sheet open", async () => {
    show({}, async () => ({ ok: false, error: "This needs your authenticator app.", mfa: true }));
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(screen.getByRole("alert")).toHaveTextContent("authenticator");
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
  it("a campaign that changed since is refused and the page reads the samples again", async () => {
    show({}, async () => ({ ok: false, error: "The campaign changed after you read the messages.", changed: true }));
    open();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Approve" })));
    expect(screen.getByRole("alert")).toHaveTextContent("changed");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("who may approve and when", () => {
  it.each(["admin", "sales"] as const)("a %s reads the messages but has no approve button", (role) => {
    show({ role });
    expect(screen.queryByRole("button", { name: "Approve this campaign" })).toBeNull();
    expect(screen.getByText(/Only the Owner can approve/)).toBeInTheDocument();
  });
  it("what is missing is listed in our sentences and approving is off", () => {
    show({ preview: parsePreview(PREVIEW_ISSUES_JSON) });
    expect(screen.getByText("Not ready yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve this campaign" })).toBeDisabled();
  });
  it("a campaign that is not a draft cannot be approved again", () => {
    show({ status: "running" });
    expect(screen.queryByRole("button", { name: "Approve this campaign" })).toBeNull();
    expect(screen.getByText(/nothing to approve/)).toBeInTheDocument();
  });
  it("says plainly when automatic sending is off", () => {
    show({ preview: { ...preview, sending_on: false } });
    expect(screen.getByText(/Automatic sending is switched off for this business/)).toBeInTheDocument();
  });
});
