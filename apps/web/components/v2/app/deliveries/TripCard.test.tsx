import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const uploadProof = vi.fn();
vi.mock("./upload-proof", () => ({ uploadProof: (...a: unknown[]) => uploadProof(...a) }));
vi.mock("../catalogue/prepare-photo", () => ({ preparePhoto: async (f: File) => ({ ok: true, blob: f }) }));

import { parseTrip } from "@/lib/api/deliveries";
import { TRIP, TRIP_DELIVERED_JSON, TRIP_JSON, TRIP_ON_THE_WAY_JSON, TRIP_PROBLEM_JSON } from "@/lib/api/deliveries-fixtures";

import { BASE, WORDS } from "../materials/mat-test-kit";
import { TripCard, type TripCardActions } from "./TripCard";

function acts(over: Partial<TripCardActions> = {}) {
  return { setStatus: vi.fn(async () => ({ ok: true as const })), notify: vi.fn(async () => ({ ok: true as const, text: "Truck left", status: "queued" })), ...over } as TripCardActions & Record<string, ReturnType<typeof vi.fn>>;
}
function show(json: object = TRIP_JSON, role: "owner" | "admin" | "sales" | "viewer" = "owner", a = acts()) {
  render(<ul><TripCard trip={parseTrip(json)} base={BASE} siteLabel="Kukatpally villa, Hyderabad" words={WORDS} role={role} actions={a} uploadUrl={`${BASE}/orders/trips/${TRIP}/delivered`} /></ul>);
  return a;
}
const click = (name: string | RegExp) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));
beforeEach(() => {
  refresh.mockClear();
  uploadProof.mockReset();
});

describe("the steps a trip offers", () => {
  it.each([
    [TRIP_JSON, ["Loaded", "There is a problem", "Cancel the trip"]],
    [TRIP_ON_THE_WAY_JSON, ["Delivered, add the proof", "There is a problem", "Tell the site"]],
    [TRIP_PROBLEM_JSON, ["Back to planned", "Cancel the trip", "Tell the site"]],
    [TRIP_DELIVERED_JSON, ["Tell the site"]],
  ])("a %# trip offers exactly its next steps", (json, names) => {
    show(json);
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(names);
  });
  it("a Viewer sees the trip and no button", () => {
    show(TRIP_JSON, "viewer");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: "Delivery note" })).toHaveAttribute("href", `${BASE}/orders/trips/${TRIP}/challan`);
  });
  it("shows the load, the vehicle, the driver, the site and, once delivered, who received it", () => {
    show(TRIP_DELIVERED_JSON);
    expect(screen.getByText(/2,500 piece · Paver block 80 mm grey/)).toBeInTheDocument();
    expect(screen.getByText(/TS 09 UA 1234 · Suresh \(synthetic\) · Kukatpally villa, Hyderabad/)).toBeInTheDocument();
    expect(screen.getByText("Received by Ravi (synthetic)")).toBeInTheDocument();
  });
});

describe("moving a trip along", () => {
  it("one tap for loaded, then the page is read again", async () => {
    const a = show();
    await click("Loaded");
    expect(a.setStatus).toHaveBeenCalledWith(TRIP, "loaded", undefined);
    expect(refresh).toHaveBeenCalled();
  });
  it("shows our sentence when the order is not dispatched yet and does not refresh", async () => {
    show({ ...TRIP_JSON, status: "loaded" }, "owner", acts({ setStatus: vi.fn(async () => ({ ok: false as const, error: "The truck cannot leave before the order is dispatched." })) as never }));
    await click("Left, on the way");
    expect(screen.getByRole("alert")).toHaveTextContent("cannot leave before the order is dispatched");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("a problem needs a reason from the closed list", async () => {
    const a = show();
    await click("There is a problem");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "road_blocked" } });
    await click("Mark the problem");
    expect(a.setStatus).toHaveBeenCalledWith(TRIP, "problem", "road_blocked");
  });
});

describe("delivered, with the proof", () => {
  const open = async () => {
    show(TRIP_ON_THE_WAY_JSON);
    await click("Delivered, add the proof");
  };
  it("asks for the name and the photo and sends nothing without them", async () => {
    await open();
    await click("Save the proof");
    expect(screen.getByRole("alert")).toHaveTextContent("name of the person who received");
    fireEvent.change(screen.getByLabelText("Received by"), { target: { value: "Ravi" } });
    await click("Save the proof");
    expect(screen.getByRole("alert")).toHaveTextContent("Add the photo");
    expect(uploadProof).not.toHaveBeenCalled();
  });
  it("sends the photo with the name and a retry id, then reads the page again", async () => {
    uploadProof.mockResolvedValue({ ok: true });
    await open();
    fireEvent.change(screen.getByLabelText("Received by"), { target: { value: "Ravi Kumar" } });
    const file = new File(["x"], "site.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [file] } });
    await click("Save the proof");
    expect(uploadProof).toHaveBeenCalledTimes(1);
    const [url, name, photoId, blob, type] = uploadProof.mock.calls[0];
    expect(url).toBe(`${BASE}/orders/trips/${TRIP}/delivered`);
    expect(name).toBe("Ravi Kumar");
    expect(photoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(blob).toBe(file);
    expect(type).toBe("image/jpeg");
    expect(refresh).toHaveBeenCalled();
  });
  it("a photo the API refuses is said in words", async () => {
    uploadProof.mockResolvedValue({ ok: false, code: "photo_too_large" });
    await open();
    fireEvent.change(screen.getByLabelText("Received by"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Photo"), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await click("Save the proof");
    expect(screen.getByRole("alert")).toHaveTextContent(/bigger|large|5 MB/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("telling the site", () => {
  it("sends a fixed kind of message, with the time when it has left, and says what the outbox did with it", async () => {
    const a = show(TRIP_ON_THE_WAY_JSON);
    await click("Tell the site");
    fireEvent.change(screen.getByLabelText(/About what time/), { target: { value: "3 pm" } });
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tell the site" })));
    expect(a.notify).toHaveBeenCalledWith(TRIP_ON_THE_WAY_JSON.id, "left", "3 pm", "en");
    expect(screen.getByRole("status")).toHaveTextContent("The message is queued in the outbox.");
  });
  it("a time that is not a time is refused before anything is sent", async () => {
    const a = show(TRIP_ON_THE_WAY_JSON);
    await click("Tell the site");
    fireEvent.change(screen.getByLabelText(/About what time/), { target: { value: "evening-ish" } });
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tell the site" })));
    expect(screen.getByRole("alert")).toHaveTextContent("Write the time like");
    expect(a.notify).not.toHaveBeenCalled();
  });
  it("a held message says it waits for the owner's OK", async () => {
    show(TRIP_ON_THE_WAY_JSON, "owner", acts({ notify: vi.fn(async () => ({ ok: true as const, text: "x", status: "needs_approval" })) as never }));
    await click("Tell the site");
    fireEvent.click(screen.getByRole("radio", { name: "The truck is delayed" }));
    await act(async () => void fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tell the site" })));
    expect(screen.getByRole("status")).toHaveTextContent("waits in the outbox for your OK");
  });
});
