import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { SetupGate } from "./SetupGate";
import { resetSetupStore } from "./setup-store";
import { BASE, T, actions, fresh, words } from "./setup-test-kit";

// NOT preloaded here: this file is the only one that sees the wizard arrive (job CF: it is its own chunk, fetched when the gate first shows it)
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetSetupStore();
});

describe("the setup wizard is fetched when it is first shown", () => {
  it("says 'getting things ready' until the wizard has arrived, then shows it, and shows Today untouched for a business that is set up", async () => {
    window.localStorage.clear();
    resetSetupStore();
    render(
      <SetupGate tenantId={T} base={BASE} lang="en" facts={fresh()} words={words} actions={actions()}>
        <div data-testid="today">Today</div>
      </SetupGate>,
    );
    // the first paint of a brand-new business is the waiting line, never a blank and never Today
    expect(document.querySelector('[data-setup="loading"]')).not.toBeNull();
    expect(screen.queryByTestId("today")).toBeNull();
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(document.querySelector('[data-setup="loading"]')).toBeNull();
    await act(async () => undefined);
  });
});
