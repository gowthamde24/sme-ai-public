import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { WORDS } from "../materials/mat-test-kit";
import { CampaignControls, type StateAction } from "./CampaignControls";

function show(status: string, act_: StateAction = async () => ({ ok: true })) {
  const a = vi.fn(act_);
  const view = render(<CampaignControls status={status} words={WORDS} act={a} />);
  return { a, view };
}
beforeEach(() => vi.clearAllMocks());

describe("pause, resume, cancel", () => {
  it("a running campaign can be paused or cancelled, each after a question", async () => {
    const { a } = show("running");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(a).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[1]));
    expect(a).toHaveBeenCalledWith("pause");
    expect(refresh).toHaveBeenCalled();
  });
  it("cancelling says it cannot be undone", () => {
    show("approved");
    fireEvent.click(screen.getByRole("button", { name: "Cancel campaign" }));
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
  });
  it("a paused campaign offers resume", () => {
    show("paused");
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
  it.each(["draft", "done", "cancelled"])("a %s campaign has no controls", (status) => {
    const { view } = show(status);
    expect(view.container).toBeEmptyDOMElement();
  });
  it("a refusal stays in the sheet in our words", async () => {
    show("running", async () => ({ ok: false, error: "The campaign is not in a state for that. Refresh the page." }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[1]));
    expect(screen.getByRole("alert")).toHaveTextContent("not in a state");
  });
});
