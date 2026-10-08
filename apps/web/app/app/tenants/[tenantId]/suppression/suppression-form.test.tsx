import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BackfillState } from "./actions";
import { BackfillForm } from "./suppression-form";

const BUTTON = "Record keys for contacts that have none";
const press = async (state: BackfillState) => {
  const action = vi.fn(async () => state);
  render(<BackfillForm action={action} secondFactorMissing={false} />);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: BUTTON })));
  return action;
};

describe("BackfillForm", () => {
  it("without a second factor it gives the reason and no button", () => {
    render(<BackfillForm action={vi.fn()} secondFactorMissing />);
    expect(screen.getByText(/needs your authenticator app/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a press runs the action once and shows counts, not a verdict", async () => {
    const action = await press({ ok: true, recorded: 5, remaining: 0, unkeyable: 0 });
    expect(action).toHaveBeenCalledTimes(1);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recorded keys for 5 contacts. Contacts still without a key: 0.");
    expect(status.textContent).not.toMatch(/\bready\b|all contacts|every contact/i);
  });

  it("says what is left and names the contacts that cannot be keyed", async () => {
    await press({ ok: true, recorded: 1, remaining: 4, unkeyable: 2 });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Recorded keys for 1 contact. Contacts still without a key: 4.");
    expect(status).toHaveTextContent("2 contacts have an e-mail or phone number that cannot be read");
  });

  it("an error is an alert of our wording and no result is shown", async () => {
    await press({ ok: false, error: "Only the owner can record suppression keys." });
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can record suppression keys.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
