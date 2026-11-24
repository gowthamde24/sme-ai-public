import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { LinkSentence } from "./LinkSentence";

afterEach(cleanup);
describe("filters without sentences (FILTERS_OPEN)", () => {
  const choices = { status: { label: "Status", value: "all", options: [{ value: "all", text: "All (6)", href: "/a" }, { value: "new", text: "New (2)", href: "/a?chip=new" }] }, source: { label: "Place", value: "all", options: [{ value: "all", text: "Everywhere", href: "/a" }] } };
  it("each choice is a labelled outlined dropdown; the sentence template is not drawn; picking goes to the same address", () => {
    render(<LinkSentence plain line="leads" template="Show {status} leads from {source}." choices={choices} />);
    expect(screen.queryByText(/Show /)).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "new" } });
    expect(push).toHaveBeenCalledWith("/a?chip=new");
  });
});
