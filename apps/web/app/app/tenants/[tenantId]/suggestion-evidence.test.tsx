import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ClaimEvidenceOut } from "@/lib/api/agents";

import { QUOTE_CHECK_LABEL, SuggestionEvidence } from "./suggestion-evidence";

const HOSTILE =
  '<img src=x onerror="alert(1)"> <script>alert(2)</script> <a href="javascript:alert(3)">click</a> "quoted" ‮ &lt;b&gt;';

const evidence = (over: Partial<ClaimEvidenceOut> = {}): ClaimEvidenceOut => ({
  kind: "web_page",
  stance: "supports",
  provider: "agent.research",
  host: "saree-house.test",
  path: "/about",
  quote: "We sell silk sarees in bulk.",
  ...over,
});

describe("SuggestionEvidence", () => {
  it("shows the quote, the source host and path, and the plain statement of what was checked", () => {
    render(<SuggestionEvidence evidence={[evidence()]} />);
    expect(screen.getByText("We sell silk sarees in bulk.")).toBeInTheDocument();
    expect(screen.getByText(/source: saree-house\.test\/about/)).toBeInTheDocument();
    expect(screen.getByText(/Supports · web page/)).toBeInTheDocument();
    expect(screen.getByText(QUOTE_CHECK_LABEL)).toBeInTheDocument();
    expect(QUOTE_CHECK_LABEL).toBe("Quote checked by the agent runtime, not by the database.");
  });

  it("renders a hostile quote, host and path as PLAIN TEXT: no element, no link, no image, no handler", () => {
    const { container } = render(
      <SuggestionEvidence evidence={[evidence({ quote: HOSTILE, host: "<b>evil</b>.test", path: '/"><script>x()</script>' })]} />,
    );
    expect(container.querySelector("script, img, a, iframe, object, embed, form, input, style, svg")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("[onerror], [onclick], [href], [src]")).toBeNull();
    expect(screen.getByText(HOSTILE)).toBeInTheDocument(); // the exact characters, as text
    expect(container.textContent).toContain("<b>evil</b>.test");
    expect(container.innerHTML).not.toContain("<img");
    expect(container.innerHTML).not.toContain("<script");
  });

  it("never turns the source into a link, whatever the host looks like", () => {
    const { container } = render(<SuggestionEvidence evidence={[evidence({ host: "https://evil.test", path: "//evil.test/x" })]} />);
    expect(container.querySelectorAll("a, [href]")).toHaveLength(0);
  });

  it("says so when there is no evidence or no quote", () => {
    const { rerender } = render(<SuggestionEvidence evidence={[]} />);
    expect(screen.getByText(/No evidence is attached/)).toBeInTheDocument();
    rerender(<SuggestionEvidence evidence={undefined} />);
    expect(screen.getByText(/No evidence is attached/)).toBeInTheDocument();
    rerender(<SuggestionEvidence evidence={[evidence({ quote: null, host: null, path: null })]} />);
    expect(screen.getByText("(no quote)")).toBeInTheDocument();
    expect(screen.queryByText(/source:/)).toBeNull();
  });

  it("wraps long words so a phone does not scroll sideways", () => {
    const { container } = render(<SuggestionEvidence evidence={[evidence({ quote: "x".repeat(300) })]} />);
    expect(container.querySelector("blockquote")?.getAttribute("style")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(container.querySelector("ul")?.getAttribute("style")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
