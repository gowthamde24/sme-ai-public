import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EvidenceItem } from "@/lib/api/evidence";

vi.mock("./evidence-actions", () => ({
  addEvidenceAction: vi.fn(async () => undefined),
}));

import { EvidencePanel } from "./evidence-panel";
import { plainText } from "@/components/v2/app/ui";

const TENANT = "22222222-2222-2222-2222-222222222222";
const TARGET = "44444444-4444-4444-4444-444444444444";
const FORM_ID = "33333333-3333-3333-3333-333333333333";

const ITEM: EvidenceItem = {
  linkId: "55555555-5555-5555-5555-555555555555",
  kind: "web_page",
  provider: "manual",
  url: "https://example.test/catalogue",
  reference: "doc:cat-1",
  snippet: "line one\nline two",
  retrievedAt: "2026-01-02T03:04:05+00:00",
  publishedAt: "2026-01-01T00:00:00+00:00",
  createdVia: "agent",
};

function panel(over: Partial<React.ComponentProps<typeof EvidencePanel>> = {}) {
  return render(
    <EvidencePanel
      tenantId={TENANT}
      target="companies"
      targetId={TARGET}
      page={{ items: [ITEM], nextCursor: null }}
      cursor={null}
      canWrite={true}
      formId={FORM_ID}
      {...over}
    />,
  );
}

describe("EvidencePanel", () => {
  it("shows kind, provider, dates, origin, URL, reference and snippet", () => {
    panel();
    // the retrieved time is a <time> element (the browser shows it in the viewer's timezone; UTC stays in the tooltip)
    const stamp = document.querySelector("time");
    expect(stamp?.getAttribute("datetime")).toBe("2026-01-02T03:04:05+00:00");
    expect(stamp?.getAttribute("title")).toBe("2026-01-02 03:04 UTC");
    const list = screen.getByRole("list");
    for (const text of [
      "Web page",
      "manual",
      "2026-01-01",
      "agent",
      "https://example.test/catalogue",
      "doc:cat-1",
    ])
      expect(within(list).getByText(text)).toBeInTheDocument();
    const snippet = list.querySelector('[data-evidence="snippet"]');
    expect(snippet?.textContent).toBe("line one\nline two");
    expect(snippet?.className).toBe(plainText);
  });

  it("hides absent optional fields instead of inventing them", () => {
    panel({
      page: {
        items: [
          {
            ...ITEM,
            url: null,
            reference: null,
            snippet: null,
            publishedAt: null,
          },
        ],
        nextCursor: null,
      },
    });
    const list = screen.getByRole("list");
    for (const label of ["URL", "Reference", "Snippet", "Published"])
      expect(within(list).queryByText(label)).toBeNull();
    expect(within(list).getByText("Retrieved")).toBeInTheDocument();
  });

  it("renders hostile content as TEXT: no anchors, images, frames, scripts, handlers", () => {
    const hostile = {
      ...ITEM,
      url: "javascript:alert(document.cookie)",
      reference: "doc:<img-src-x>",
      snippet:
        '<a href="https://evil.example/steal">click</a><img src="https://evil.example/p.png" onerror="alert(1)"><script>alert(1)</script><iframe src="https://evil.example"></iframe>',
    };
    const { container } = panel({
      page: { items: [hostile], nextCursor: null },
    });
    const list = container.querySelector("section ul") as HTMLElement;
    expect(
      list.querySelector(
        "a, img, iframe, script, object, embed, video, audio, form, link, base",
      ),
    ).toBeNull();
    expect(list.innerHTML).not.toMatch(/<a\b|<img\b|<script\b|<iframe\b/i);
    expect(list.querySelector('[data-evidence="url"]')?.textContent).toBe(
      "javascript:alert(document.cookie)",
    );
    expect(list.querySelector('[data-evidence="snippet"]')?.textContent).toBe(
      hostile.snippet,
    );
    expect(
      list.querySelectorAll("[onerror],[onclick],[href],[src]"),
    ).toHaveLength(0);
  });

  it("an https URL is still only text, never a link", () => {
    const { container } = panel();
    const list = container.querySelector("section ul") as HTMLElement;
    expect(list.querySelector("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /example\.test/ })).toBeNull();
  });

  it("the only links are internal: Load more (opaque cursor) and Back", () => {
    panel({ page: { items: [ITEM], nextCursor: "a+b/c=" }, cursor: "prev" });
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Load more",
      "Back to the first page",
    ]);
    expect(links[0]).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/companies/${TARGET}?cursor=${encodeURIComponent("a+b/c=")}`,
    );
    expect(links[1]).toHaveAttribute(
      "href",
      `/app/tenants/${TENANT}/companies/${TARGET}`,
    );
  });

  it("empty states", () => {
    panel({ page: { items: [], nextCursor: null } });
    expect(screen.getByText("No evidence yet.")).toBeInTheDocument();
  });

  it("an empty later page says so", () => {
    panel({ page: { items: [], nextCursor: null }, cursor: "x" });
    expect(screen.getByText("No more evidence.")).toBeInTheDocument();
  });

  it("API down: an error and no placeholder rows", () => {
    panel({ page: null });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load the evidence",
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText("No evidence yet.")).toBeNull();
  });

  it("shows the add form only to roles that may write", () => {
    panel({ canWrite: true });
    expect(
      screen.getByRole("form", { name: "Add evidence" }),
    ).toBeInTheDocument();
  });

  it("hides the add form from viewers", () => {
    panel({ canWrite: false });
    expect(screen.queryByRole("form", { name: "Add evidence" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add evidence" })).toBeNull();
  });

  it("states that sources are never opened or fetched", () => {
    panel();
    expect(
      screen.getByText(/never opened, fetched or previewed/),
    ).toBeInTheDocument();
  });

  it("has no archive, delete or edit control", () => {
    panel();
    expect(
      screen.queryByRole("button", {
        name: /archive|delete|remove|edit|restore/i,
      }),
    ).toBeNull();
  });
});
