import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultEmployee, employee, ok, show } from "./fixtures";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the page of one AI employee: tabs", () => {
  it("draws the six tabs as real tabs and opens Overview", async () => {
    show();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Voice and language", "Rules", "Responsibilities", "Activity", "Phone"]);
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("tabindex", "-1");
    expect(await screen.findByRole("heading", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
  });

  it("moves with the arrow keys, Home and End, and writes the tab in the address", async () => {
    show();
    const overview = screen.getByRole("tab", { name: "Overview" });
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    const voice = screen.getByRole("tab", { name: "Voice and language" });
    expect(voice).toHaveAttribute("aria-selected", "true");
    expect(voice).toHaveFocus();
    expect(window.location.search).toBe("?tab=voice");
    fireEvent.keyDown(voice, { key: "End" });
    expect(screen.getByRole("tab", { name: "Phone" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Phone" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Phone" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Phone" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tab named in the address and keeps the other panels out of view", async () => {
    show({ initialTab: "rules" });
    expect(screen.getByRole("tab", { name: "Rules" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "What it may do alone" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Status" })).toBeNull();
  });
});

describe("Overview", () => {
  it("shows the status, today's calls, the languages and the summary", async () => {
    show();
    await screen.findByRole("heading", { name: "Status" });
    expect(screen.getByText("3 calls today")).toBeInTheDocument();
    expect(screen.getByText("Languages: తెలుగు · English")).toBeInTheDocument();
    expect(screen.getByText("Sunita: Showroom helper, with 2 jobs to take care of.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sunita");
  });

  it("saves only the name that changed, then says Saved", async () => {
    const { a } = show();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "  Meena " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledTimes(1));
    expect(a.patch).toHaveBeenCalledWith({ name: "Meena" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("clears the role title with null and changes the role code", async () => {
    const { a } = show();
    fireEvent.change(await screen.findByLabelText("Role title"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "sales" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(a.patch).toHaveBeenCalledWith({ roleCode: "sales", roleTitle: null }));
  });

  it("does not send a role title that is too short", async () => {
    const { a } = show();
    fireEvent.change(await screen.findByLabelText("Role title"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please check what you wrote and try again.");
    expect(a.patch).not.toHaveBeenCalled();
  });

  it("keeps Save off while nothing changed", async () => {
    show();
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says the closed sentence of a refusal", async () => {
    const { a } = show();
    a.patch.mockResolvedValueOnce({ ok: false, error: "name_taken" });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Ravi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another AI employee already has that name. Pick a different name.");
  });

  it("is a real switch: red and 'Paused' when off, green and 'On' when on; a tap turns it on and off", async () => {
    const { a } = show({ employee: employee({ status: "paused" }) });
    const sw = await screen.findByRole("switch", { name: "Sunita" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveTextContent("Paused");
    fireEvent.click(sw);
    await waitFor(() => expect(a.setStatus).toHaveBeenCalledWith("on"));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Sunita" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Sunita" })).toHaveTextContent("On");
    fireEvent.click(screen.getByRole("switch", { name: "Sunita" }));
    await waitFor(() => expect(a.setStatus).toHaveBeenLastCalledWith("paused"));
  });

  it("asks before it archives, and Keep it cancels", async () => {
    const { a } = show();
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    const box = screen.getByRole("alertdialog");
    expect(within(box).getByText("Archive keeps its history and frees its number.")).toBeInTheDocument();
    expect(a.setStatus).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole("button", { name: "No, keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(a.setStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, archive Sunita" }));
    await waitFor(() => expect(a.setStatus).toHaveBeenCalledWith("archived"));
    expect(await screen.findByText("Archived", { selector: "[data-part=emp-status-chip]" })).toBeInTheDocument();
  });

  it("shows the refusal of a status change", async () => {
    const { a } = show();
    a.setStatus.mockResolvedValueOnce({ ok: false, error: "last_default" });
    fireEvent.click(await screen.findByRole("switch", { name: "Sunita" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The main assistant cannot be paused or archived.");
  });
});

describe("a reader (not owner or admin)", () => {
  it("sees the values, no Save and no status buttons, and the plain sentence", async () => {
    show({ canEdit: false });
    expect(await screen.findByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.getByText("Only the owner or an admin can add or change AI employees.")).toBeInTheDocument();
  });
});

describe("the main assistant (default employee)", () => {
  it("has no status buttons and says what it is", async () => {
    show({ employee: defaultEmployee() });
    expect(await screen.findByText("Answers every call and chat unless another AI employee has that number.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("can change its name, and a settings_elsewhere answer is said in plain words", async () => {
    const { a } = show({ employee: defaultEmployee() });
    a.patch.mockResolvedValueOnce({ ok: false, error: "settings_elsewhere" });
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Meena" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This is set in My assistant, not here.");
    a.patch.mockResolvedValueOnce(ok(defaultEmployee({ name: "Meena" })));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Meena"));
    expect(a.patch).toHaveBeenLastCalledWith({ name: "Meena" });
  });

  it("shows the voice read-only with a link to My assistant", async () => {
    show({ employee: defaultEmployee({ voices: { te: "te_ramya" } , languages: ["te"] }), initialTab: "voice" });
    const note = await screen.findByText(/This AI employee is your main assistant/);
    expect(note.closest("p")).toHaveTextContent("Its voice and way of speaking are set in My assistant.");
    expect(screen.getByRole("link", { name: "Open My assistant" })).toHaveAttribute("href", "/app/tenants/t/my-assistant");
    expect(screen.getByText("Ramya", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use /i })).toBeNull();
  });
});

vi.mock("next/link", () => import("./link-mock"));
