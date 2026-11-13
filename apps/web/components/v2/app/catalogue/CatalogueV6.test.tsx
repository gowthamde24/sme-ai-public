import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CatalogueView } from "./CatalogueView";
import { ItemEditor } from "./ItemEditor";
import { BASE, WORDS, fakeEditorActions, item, makeWorld, rows } from "./catalogue-test-kit";
import { EMPTY_QUERY } from "./catalogue-logic";
import { photoJson } from "@/lib/api/catalogue-fixtures";

afterEach(cleanup);
const grid = (over: Partial<Parameters<typeof CatalogueView>[0]> = {}) => render(<CatalogueView ds base={BASE} words={WORDS} role="owner" query={EMPTY_QUERY} items={rows()} more={null} lead={null} help={<button type="button">?</button>} {...over} />);

describe("the catalogue (design system v6)", () => {
  it("has the page header with the '?' and one main button, and an Edit link under each saree for the owner and admin", () => {
    grid();
    expect(screen.getByRole("heading", { level: 1, name: "Catalogue" })).toBeInTheDocument();
    expect(screen.getByText(/Customers see the ones you have published/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "?" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Add a saree" })).toHaveLength(1);
    const edits = screen.getAllByRole("link", { name: "Edit" });
    expect(edits).toHaveLength(4);
    expect(edits[0].getAttribute("href")).toMatch(/\/catalogue\/[0-9a-f-]+\/edit$/);
  });
  it("names the drafts: the sarees that customers do not see yet", () => {
    grid();
    expect(document.querySelector('[data-note="drafts"]')).toHaveTextContent("Drafts: 1");
  });
  it("gives a sales member no Edit link and no draft line", () => {
    grid({ role: "sales", items: rows().filter((r) => r.active) });
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(document.querySelector('[data-note="drafts"]')).toBeNull();
  });
  it("an empty catalogue shows its next step", () => {
    grid({ items: [] });
    const next = document.querySelector('[data-part="empty-next"]') as HTMLElement;
    expect(within(next).getByRole("link", { name: "Add a saree" })).toHaveAttribute("href", `${BASE}/catalogue/new`);
  });
  it("without the design system nothing changes: no Edit links, the old header", () => {
    render(<CatalogueView base={BASE} words={WORDS} role="owner" query={EMPTY_QUERY} items={rows()} more={null} lead={null} />);
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(document.querySelector('[data-part="page-header"]')).toBeNull();
  });
});

describe("the one main button of the saree editor", () => {
  const ID = "c27a36f2-ef14-5f33-b10f-3e03bade04aa";
  const draft = () => item({ active: false }, [photoJson("11111111-aaaa-4aaa-8aaa-000000000001", 1)]);
  const edit = (v6: boolean, it = draft()) => {
    const world = makeWorld(it);
    render(<ItemEditor v6={v6} base={BASE} itemId={ID} item={it} role="owner" words={WORDS} uploadUrl="/u" actions={world.actions} uploader={world.uploader} go={vi.fn()} />);
  };
  it("says Publish when pressing it shows a draft to customers, Save otherwise", () => {
    edit(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
  it("says Save for a saree that is already shown, and without the design system always Save", () => {
    cleanup();
    edit(true, item({ active: true }, [photoJson("11111111-aaaa-4aaa-8aaa-000000000001", 1)]));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    cleanup();
    edit(false);
    fireEvent.click(screen.getByLabelText("Show this saree to customers"));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
  void fakeEditorActions;
});
