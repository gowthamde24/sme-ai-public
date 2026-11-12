import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const seen: Array<{ prefetch: unknown }> = [];
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...rest }: { prefetch?: unknown; children?: React.ReactNode } & Record<string, unknown>) => {
    seen.push({ prefetch });
    return <a data-prefetch={String(prefetch)} {...(rest as object)}>{children}</a>;
  },
}));

import { IntentLink } from "./NavGroups";

describe("IntentLink: prefetched only when the person shows intent", () => {
  it("is not prefetched while it is only on screen, even if the caller asked for it", () => {
    render(<IntentLink href="/a" prefetch>One</IntentLink>);
    expect(screen.getByText("One")).toHaveAttribute("data-prefetch", "false");
  });
  it.each([["pointer or finger", (el: HTMLElement) => fireEvent.pointerEnter(el)], ["keyboard focus", (el: HTMLElement) => fireEvent.focus(el)]])("a %s on it turns the prefetch on for this link only", (_name, act) => {
    render(<><IntentLink href="/b">Two</IntentLink><IntentLink href="/c">Other</IntentLink></>);
    const link = screen.getByText("Two");
    expect(link).toHaveAttribute("data-prefetch", "false");
    act(link);
    expect(link).toHaveAttribute("data-prefetch", "null"); // (the default: the route's own prefetch)
    expect(screen.getByText("Other")).toHaveAttribute("data-prefetch", "false");
  });
  it("keeps every other prop of the link", () => {
    render(<IntentLink href="/c" aria-current="page" className="x" data-nav-row="today">Three</IntentLink>);
    const link = screen.getByText("Three");
    expect(link).toHaveAttribute("href", "/c");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("x");
    expect(link).toHaveAttribute("data-nav-row", "today");
  });
});
