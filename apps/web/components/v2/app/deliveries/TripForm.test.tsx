import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { BASE, WORDS } from "../materials/mat-test-kit";
import { TripForm, type TripFormActions } from "./TripForm";

const ROOMS = [{ lineNo: 1, name: "Paver block 80 mm", unit: "pieces", ordered: 4725, planned: 0, remaining: 4725 }];
const SITES = [{ id: "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a", label: "Kukatpally villa, Hyderabad" }];
function show(save: TripFormActions["save"] = vi.fn(async (i) => ({ ok: true as const, date: i.plannedDate })), over: Partial<React.ComponentProps<typeof TripForm>> = {}) {
  const go = vi.fn();
  render(<TripForm base={BASE} rooms={ROOMS} sites={SITES} initial={{ plannedDate: "2026-10-20", vehicleNo: "", driverName: "", driverPhone: "", siteId: "", quantities: { 1: "2500" } }} today="2026-10-14" words={WORDS} actions={{ save }} backHref={`${BASE}/orders/x`} editing={false} go={go} {...over} />);
  return { save: save as ReturnType<typeof vi.fn>, go };
}
const submit = () => act(async () => void fireEvent.click(screen.getByRole("button", { name: /Save the trip|Save the changes/ })));

describe("planning a trip", () => {
  it("shows how much of each line is ordered, on other trips and left", () => {
    show();
    expect(screen.getByText("Ordered 4,725, on other trips 0, left 4,725")).toBeInTheDocument();
  });
  it("sends the date, the vehicle, the driver, the site and the load, then goes to that day's board", async () => {
    const { save, go } = show();
    fireEvent.change(screen.getByLabelText("Vehicle number"), { target: { value: "TS 09 UA 1234" } });
    fireEvent.change(screen.getByLabelText("Driver's name"), { target: { value: "Suresh" } });
    fireEvent.change(screen.getByLabelText("Driver's phone number"), { target: { value: "+91 90000 20001" } });
    fireEvent.change(screen.getByLabelText("Site"), { target: { value: SITES[0].id } });
    await submit();
    expect(save).toHaveBeenCalledWith({ plannedDate: "2026-10-20", vehicleNo: "TS 09 UA 1234", driverName: "Suresh", driverPhone: "+91 90000 20001", siteId: SITES[0].id, lines: [{ line_no: 1, quantity: 2500 }] });
    expect(go).toHaveBeenCalledWith(`${BASE}/orders/trips?date=2026-10-20&saved=1`);
  });
  it("a line left empty does not travel; at least one line must", async () => {
    const { save } = show(undefined, { initial: { plannedDate: "2026-10-20", vehicleNo: "", driverName: "", driverPhone: "", siteId: "", quantities: {} } });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("at least one line");
    expect(save).not.toHaveBeenCalled();
  });
  it.each([["Vehicle number", "!!", "vehicle number looks wrong"], ["Driver's phone number", "call me", "phone number looks wrong"]])("%s = %j is refused in words before anything is sent", async (label, value, text) => {
    const { save } = show();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(save).not.toHaveBeenCalled();
  });
  it("a quantity that is not a whole number names the product", async () => {
    show();
    fireEvent.change(screen.getByLabelText(/Paver block 80 mm/), { target: { value: "12.5" } });
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Write a whole number for Paver block 80 mm.");
  });
  it("shows the API's refusal in our sentence and stays on the form", async () => {
    const { go } = show(vi.fn(async () => ({ ok: false as const, error: "That is more than the order holds, counting the other trips." })) as never);
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("more than the order holds");
    expect(go).not.toHaveBeenCalled();
  });
  it("changing a trip says so on the button and allows a past date", () => {
    show(undefined, { editing: true, today: "2026-10-25" });
    expect(screen.getByRole("button", { name: "Save the changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).not.toHaveAttribute("min");
  });
});
