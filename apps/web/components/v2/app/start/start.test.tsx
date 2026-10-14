import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appT } from "@/i18n/app";
import type { Activation } from "@/lib/packs/activation";

import { ActivationCard } from "./ActivationCard";
import { ExampleBanner } from "./ExampleBanner";
import { ProfileStep } from "./ProfileStep";

const t = appT("en");
const base = "/app/tenants/T";
afterEach(cleanup);

const step = (id: string, state: "done" | "todo" | "unavailable", href: string | null = `/${id}`) => ({ id, check: "business_profile" as const, title: `Title ${id}`, hint: `Hint ${id}`, state, href });
const act = (steps: Activation["steps"]): Activation => ({ steps, done: steps.filter((s) => s.state === "done").length, total: steps.length, next: steps.find((s) => s.state === "todo") ?? null });

describe("the activation card on Today", () => {
  it("lists the steps with their real state: done is struck through, to do is a link with its hint, not available yet is plain text", () => {
    render(<ActivationCard base={base} t={t} activation={act([step("a", "done"), step("b", "todo"), step("c", "unavailable", null)])} />);
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual(["done", "todo", "unavailable"]);
    expect(within(items[0]).queryByRole("link")).toBeNull();
    expect(within(items[1]).getByRole("link")).toHaveAttribute("href", `${base}/b`);
    expect(within(items[1]).getByText("Hint b")).toBeInTheDocument();
    expect(within(items[2]).getByText("Not available yet")).toBeInTheDocument();
    expect(within(items[2]).queryByRole("link")).toBeNull();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", `${base}/b`);
  });
  it("is gone when every step is done (activated), and when there are no steps", () => {
    const { container, rerender } = render(<ActivationCard base={base} t={t} activation={act([step("a", "done")])} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ActivationCard base={base} t={t} activation={act([])} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("has no Continue button when only steps without a screen are left", () => {
    render(<ActivationCard base={base} t={t} activation={act([step("a", "done"), step("c", "unavailable", null)])} />);
    expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
  });
});

describe("the example-data banner", () => {
  const actions = () => ({ load: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) });
  it("offers one button to load the sample when the server says it can, and says what it does", () => {
    const a = actions();
    render(<ExampleBanner state="available" notice={null} load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("heading", { name: "See how it works with example data" })).toBeInTheDocument();
    expect(screen.getByText(/clearly marked as example/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load example data" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
  it("when the sample is loaded it says so and offers removal behind one confirming press", () => {
    const a = actions();
    render(<ExampleBanner state="loaded" notice="loaded" load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("heading", { name: "You are looking at example data" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Example data loaded.");
    expect(screen.queryByRole("button", { name: "Load example data" })).toBeNull();
    expect(screen.getByText("Remove example data").closest("details")!.open).toBe(false);
    expect(screen.getByText("This removes only the example rows. Your own work stays.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, remove the example data" })).toBeInTheDocument();
  });
  it("says plainly when it is not available or failed, and what stayed when some example rows were already used", () => {
    const a = actions();
    const { rerender } = render(<ExampleBanner state="available" notice={null} load={a.load} remove={a.remove} t={t} />);
    rerender(<ExampleBanner state="available" notice="unavailable" load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Example data is not available yet.");
    rerender(<ExampleBanner state="available" notice="failed" load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not do that. Try again.");
    rerender(<ExampleBanner state="available" notice="removed" load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("status")).toHaveTextContent("Example data removed.");
    rerender(<ExampleBanner state="available" notice="removed" kept={3} load={a.load} remove={a.remove} t={t} />);
    expect(screen.getByRole("status")).toHaveTextContent("3 example rows stay because you have used them.");
  });
});

describe("the business name and city question", () => {
  const words = { "start.profile.title": "Your business", "start.profile.name": "Business name", "start.profile.town": "City or town", "start.profile.town.help": "Help", "start.profile.save": "Save", "start.profile.saved": "Saved.", "start.profile.err.invalid": "Give a name and a city.", "start.profile.err.role": "Only the owner.", "start.profile.err.failed": "Could not save.", "start.back": "Back to Today" };
  it("asks exactly two things, starts from what the business has, and saves them with one press", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    render(<ProfileStep action={action} words={words} name="My business" town="" backHref={base} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByLabelText("Business name")).toHaveValue("My business");
    expect(screen.getByLabelText("City or town")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Pavers Corner" } });
    fireEvent.change(screen.getByLabelText("City or town"), { target: { value: "Guntur" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    const sent = (action.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect([sent.get("name"), sent.get("town")]).toEqual(["Pavers Corner", "Guntur"]);
    expect(screen.getByRole("link", { name: "Back to Today" })).toHaveAttribute("href", base);
  });
  it("shows the sentence of a refusal and no way back", async () => {
    const action = vi.fn(async () => ({ ok: false as const, error: "role" as const }));
    render(<ProfileStep action={action} words={words} name="A" town="Bb" backHref={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner.");
    expect(screen.queryByRole("link", { name: "Back to Today" })).toBeNull();
  });
});
