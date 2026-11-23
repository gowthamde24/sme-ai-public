import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OpenTabs } from "./OpenTabs";

afterEach(cleanup);
const labels = { customers: "To your customers", you: "To you", tabs: "Who it talks to" };

describe("My assistant, open layout: two real tabs", () => {
  it("shows the customers panel first; a tap (or the arrow key) opens 'To you' and hides the other panel", () => {
    render(<OpenTabs customers={<p>voice card</p>} you={<p>talk to you</p>} labels={labels} />);
    expect(screen.getByRole("tablist", { name: "Who it talks to" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "To your customers" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("voice card")).toBeVisible();
    expect(screen.getByText("talk to you")).not.toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "To your customers" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "To you" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("talk to you")).toBeVisible();
    expect(screen.getByText("voice card")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "To your customers" }));
    expect(screen.getByText("voice card")).toBeVisible();
  });
  it("without a 'To you' part there is no tab row, only the customers' panel", () => {
    render(<OpenTabs customers={<p>voice card</p>} you={null} labels={labels} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("voice card")).toBeVisible();
  });
});
