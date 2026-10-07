import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { FollowupActionState } from "./followup-actions";
import { useFollowupAction } from "./use-followup-action";

function Probe({ action }: { action: (p: FollowupActionState, f: FormData) => Promise<FollowupActionState> }) {
  const { state, formAction, pending } = useFollowupAction(action);
  return (
    <form action={formAction}>
      <button type="submit">go</button>
      <span data-testid="pending">{String(pending)}</span>
      <span data-testid="state">{JSON.stringify(state ?? null)}</span>
    </form>
  );
}
const shown = () => JSON.parse(screen.getByTestId("state").textContent ?? "null");

beforeEach(() => refresh.mockClear());

describe("useFollowupAction", () => {
  it("starts with no state and not pending", () => {
    render(<Probe action={async () => undefined} />);
    expect(shown()).toBeNull();
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("is pending while the action runs, then shows its outcome", async () => {
    let release: (s: FollowupActionState) => void = () => {};
    render(<Probe action={() => new Promise((resolve) => (release = resolve))} />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("true"));
    await act(async () => release({ ok: true, message: "Done." }));
    await waitFor(() => expect(screen.getByTestId("pending").textContent).toBe("false"));
    expect(shown()).toEqual({ ok: true, message: "Done." });
  });

  it("a success does not read the page again", async () => {
    render(<Probe action={async () => ({ ok: true, message: "Done." })} />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(shown()).toEqual({ ok: true, message: "Done." }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("an ordinary error is shown and the page is not read again", async () => {
    render(<Probe action={async () => ({ ok: false, error: "Nope.", stale: false })} />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(shown()).toEqual({ ok: false, error: "Nope.", stale: false }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a stale refusal reads the page again, once", async () => {
    render(<Probe action={async () => ({ ok: false, error: "Changed.", stale: true })} />);
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(shown().error).toBe("Changed.");
  });
});
