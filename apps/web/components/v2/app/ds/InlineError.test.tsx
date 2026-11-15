import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineError } from "./InlineError";

afterEach(cleanup);

describe("the inline error row", () => {
  it("says what happened in one row and offers Try again, which loads the page again", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<InlineError text="Campaigns are not available right now." retry="Try again" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Campaigns are not available right now.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
