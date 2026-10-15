import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { parseLateFeesPreview } from "@/lib/api/education";
import { LATE_FEES_JSON } from "@/lib/api/education-fixtures";

import { WORDS } from "../materials/mat-test-kit";
import { LateFeesPanel, type LateFeesAction } from "./LateFeesPanel";

function show(over: Partial<React.ComponentProps<typeof LateFeesPanel>> = {}, post?: LateFeesAction) {
  const action = vi.fn<LateFeesAction>(post ?? (async () => ({ ok: true, posted: 2, totalPaise: 40000 })));
  render(<LateFeesPanel preview={parseLateFeesPreview(LATE_FEES_JSON)} canPost words={WORDS} post={action} {...over} />);
  return action;
}
beforeEach(() => vi.clearAllMocks());

describe("late fees", () => {
  it("looking changes nothing; posting asks first with the total in words", async () => {
    const a = show();
    expect(a).not.toHaveBeenCalled();
    expect(screen.getByText("₹400.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Post these late fees" }));
    expect(a).not.toHaveBeenCalled();
    expect(screen.getByText(/Four hundred/i)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Post the late fees" })));
    expect(a).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Posted 2 late fees, ₹400.00 in all");
    expect(refresh).toHaveBeenCalled();
  });
  it("nothing late is said plainly and has no button", () => {
    show({ preview: parseLateFeesPreview({ ...LATE_FEES_JSON, count: 0, total_paise: 0, rows: [] }) });
    expect(screen.getByText(/No instalment is late/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post these late fees" })).toBeNull();
  });
  it("Sales read the preview but cannot post", () => {
    show({ canPost: false });
    expect(screen.queryByRole("button", { name: "Post these late fees" })).toBeNull();
    expect(screen.getByText(/Only the Owner and Admins can post late fees/)).toBeInTheDocument();
  });
  it("a missing second factor points at the Security page", async () => {
    show({}, async () => ({ ok: false, error: "This needs your authenticator app.", mfa: true }));
    fireEvent.click(screen.getByRole("button", { name: "Post these late fees" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Post the late fees" })));
    expect(screen.getByRole("alert")).toHaveTextContent("authenticator");
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
});
