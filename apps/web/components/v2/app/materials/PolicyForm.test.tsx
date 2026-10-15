import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { parsePolicy } from "@/lib/api/materials";
import { POLICY_JSON } from "@/lib/api/materials-fixtures";

import { PolicyForm } from "./PolicyForm";
import { BASE, WORDS } from "./mat-test-kit";

const VERSION = "9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b";
function show(over: Partial<React.ComponentProps<typeof PolicyForm>> = {}) {
  const save = vi.fn(async () => ({ ok: true as const }));
  const go = vi.fn();
  render(<PolicyForm base={BASE} versionId={VERSION} current={parsePolicy(POLICY_JSON).current?.policy ?? null} words={WORDS} save={save} go={go} {...over} />);
  return { save: save as ReturnType<typeof vi.fn>, go };
}
const submit = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save the rules" })));

describe("the quote rules form", () => {
  it("starts from the rules in force", () => {
    show();
    expect(screen.getByLabelText(/Wastage added to the pieces/)).toHaveValue("5");
    expect(screen.getByLabelText(/Rate for one trip/)).toHaveValue("3500");
    expect(screen.getByLabelText(/What one truck carries/)).toHaveValue("2500");
    expect(screen.getByLabelText(/Advance before dispatch/)).toHaveValue("50");
  });
  it("saves a NEW version with the page's id: nothing else is assumed", async () => {
    const { save, go } = show();
    fireEvent.change(screen.getByLabelText(/Advance before dispatch/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I charge for laying" }));
    fireEvent.change(screen.getByLabelText(/Laying rate per sq ft/), { target: { value: "12" } });
    fireEvent.change(screen.getAllByLabelText(/GST on it/)[1], { target: { value: "18" } });
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    const [id, policy] = save.mock.calls[0];
    expect(id).toBe(VERSION);
    expect(policy).toMatchObject({ advance_bps: 3000, laying: { rate_paise_per_area: 1200, gst_bps: 1800 }, transport: { kind: "per_trip", rate_per_trip_paise: 350000, truck_capacity: 2500 } });
    expect(go).toHaveBeenCalledWith(`${BASE}/quote-policy?saved=1`);
  });
  it("names the box that is wrong and sends nothing", async () => {
    const { save } = show();
    fireEvent.change(screen.getByLabelText(/Advance before dispatch/), { target: { value: "150" } });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Check this box: Advance");
    expect(screen.getByLabelText(/Advance before dispatch/)).toHaveAttribute("aria-invalid", "true");
    expect(save).not.toHaveBeenCalled();
  });
  it("freight by the kilometre is a list of slabs that can grow and shrink", () => {
    show({ current: null });
    fireEvent.click(screen.getByRole("radio", { name: /By the kilometre/ }));
    expect(screen.getAllByLabelText("Up to km")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Add a slab" }));
    expect(screen.getAllByLabelText("Up to km")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove slab 2" }));
    expect(screen.getAllByLabelText("Up to km")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove slab 1" })).toBeDisabled();
  });
  it("shows the Security link when the second factor is missing", async () => {
    show({ save: vi.fn(async () => ({ ok: false as const, error: "This needs your authenticator app.", mfa: true })) as never });
    await submit();
    expect(screen.getByRole("link", { name: /Security/ })).toHaveAttribute("href", "/app/security");
  });
});
