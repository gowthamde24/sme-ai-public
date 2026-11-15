import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stashNote } from "@/lib/client-actions/note";

import { AssistantNote } from "./AssistantNote";

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("the assistant's note on the Leads page", () => {
  it("shows what the assistant left, once", () => {
    stashNote("leads", "Showing these leads; the date part is not available yet, so it shows all of them.");
    const first = render(<AssistantNote />);
    expect(screen.getByRole("status")).toHaveTextContent(/date part is not available yet/);
    first.unmount();
    const second = render(<AssistantNote />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("draws nothing when there is no note, and shows markup as plain text", () => {
    const none = render(<AssistantNote />);
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();
    stashNote("leads", "<b>bold</b>");
    render(<AssistantNote />);
    expect(screen.getByRole("status").innerHTML).not.toContain("<b>");
  });
});
