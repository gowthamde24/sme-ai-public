import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { CallLimit } from "@/lib/api/call-limit";

import { CallLimitCard } from "./CallLimitCard";

afterEach(cleanup);

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("cl.") || k === "dst.af.back"));
const START: CallLimit = { limit: 100, used: 23, remaining: 77, defaultLimit: 100 };
type Save = (limit: number) => Promise<{ ok: true; data: CallLimit } | { ok: false; error: "range" | "forbidden" | "down" }>;
const draw = (over: { canEdit?: boolean; save?: ReturnType<typeof vi.fn<Save>> } = {}) => {
  const save = over.save ?? vi.fn<Save>(async (n) => ({ ok: true, data: { ...START, limit: n, remaining: n - START.used } }));
  render(<CallLimitCard words={words} initial={START} canEdit={over.canEdit ?? true} mock={false} actions={{ save }} />);
  return save;
};

describe("Calls per day (My assistant > Rules)", () => {
  it("says the limit's purpose, the default and what is used today", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Calls per day" })).toBeInTheDocument();
    expect(screen.getByText(/The default is 100\./)).toBeInTheDocument();
    expect(screen.getByText("23 used today, 77 left")).toBeInTheDocument();
  });
  it("a change asks one question first ('Change the limit to 150 calls a day?'): nothing is saved until 'Yes, change it'; 'Back' keeps the old number", async () => {
    const save = draw();
    fireEvent.change(screen.getByLabelText("Calls a day (1 to 5000)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Change the limit to 150 calls a day?")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, change it" }));
    await screen.findByText("Saved: 150 calls a day.");
    expect(save).toHaveBeenCalledWith(150);
    expect(screen.getByText("23 used today, 127 left")).toBeInTheDocument();
  });
  it("a number outside 1 to 5000 cannot be saved; the same number as now cannot either", () => {
    draw();
    const input = screen.getByLabelText("Calls a day (1 to 5000)");
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number from 1 to 5000.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "5001" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "100" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
  it("someone who is not the Owner sees the numbers and no field; a refusal is a closed sentence", async () => {
    draw({ canEdit: false });
    expect(screen.queryByLabelText("Calls a day (1 to 5000)")).toBeNull();
    expect(screen.getByText("23 used today, 77 left")).toBeInTheDocument();
    cleanup();
    draw({ save: vi.fn<Save>(async () => ({ ok: false, error: "forbidden" })) });
    fireEvent.change(screen.getByLabelText("Calls a day (1 to 5000)"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, change it" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only the Owner can change this."));
  });
});
