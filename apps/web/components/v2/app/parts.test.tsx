import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: () => "font-vars" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (n === "sme_theme" ? { name: n, value: "dark" } : undefined) }) }));

import { ActionResultV2, ApiDownV2, NoticeV2, NotShownV2, PageHeader, Panel, Pill, ScreenIsland } from "./parts";

describe("the shared v2 pieces say what the old ones said", () => {
  it("ApiDown: the same alert sentence and the same way back", () => {
    render(<ApiDownV2 />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load this from the API. Try again shortly.");
    expect(screen.getByRole("link", { name: "Back to your workspaces" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
  it("NotShown: the way back to the workspace, the title and one closed sentence", () => {
    render(<NotShownV2 tenantId="t1" tenantName="Acme" title="Follow-ups due" message="Follow-ups are shown to owners, admins and sales users." />);
    expect(screen.getByRole("link", { name: "← Acme" })).toHaveAttribute("href", "/app/tenants/t1");
    expect(screen.getByRole("heading", { level: 1, name: "Follow-ups due" })).toBeInTheDocument();
    expect(screen.getByText("Follow-ups are shown to owners, admins and sales users.")).toBeInTheDocument();
  });
  it("Notice keeps its note role; ActionResult keeps alert for an error and status for a message, and nothing otherwise", () => {
    const { rerender, container } = render(<NoticeV2>Nothing is sent.</NoticeV2>);
    expect(screen.getByRole("note")).toHaveTextContent("Nothing is sent.");
    rerender(<ActionResultV2 state={{ error: "Not saved." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved.");
    rerender(<ActionResultV2 state={{ ok: true, message: "Saved." }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    rerender(<ActionResultV2 state={{ ok: true }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ActionResultV2 state={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("PageHeader keeps the back link, the heading and the role line", () => {
    render(<PageHeader back={{ href: "/app", label: "Workspaces" }} title="Orders" role="owner" />);
    expect(screen.getByRole("link", { name: "← Workspaces" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Orders" })).toBeInTheDocument();
    expect(screen.getByText(/Your role:/)).toHaveTextContent("Your role: owner");
  });
  it("Panel and Pill render their content", () => {
    render(
      <Panel labelledBy="h">
        <h2 id="h">Money</h2>
        <Pill tone="green">Approved</Pill>
      </Panel>,
    );
    expect(screen.getByRole("region", { name: "Money" })).toHaveTextContent("Approved");
  });
  it("ScreenIsland is a v2 wrapper that follows the saved theme", async () => {
    const { container } = render(await ScreenIsland({ children: <p>in the island</p> }));
    const root = container.querySelector('[data-ui="v2"]');
    expect(root).toHaveAttribute("data-theme", "dark");
    expect(root).toHaveAttribute("lang", "en");
    expect(root).toContainElement(screen.getByText("in the island"));
  });
});
