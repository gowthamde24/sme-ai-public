import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let path = "/app/tenants/t";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

import { BrandLoading, FirstOpenMark, LOADING_AFTER_MS, NavLoading } from "./BrandLoading";
import { JOB_TONES, JobChip } from "./JobChip";
import { Skeleton } from "./Skeleton";
import { Radio, Tick } from "./Tick";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-nav-loading");
});

describe("the solid status chip", () => {
  it("has four tones, each with its icon and the word (colour is never the only sign)", () => {
    for (const tone of JOB_TONES) {
      const { container, unmount } = render(<JobChip tone={tone}>{tone} word</JobChip>);
      const chip = container.querySelector(".jb-chip") as HTMLElement;
      expect(chip).toHaveAttribute("data-tone", tone);
      expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(chip).toHaveTextContent(`${tone} word`);
      unmount();
    }
  });
});

describe("the round tick box and radio", () => {
  it("are the real native inputs with their label: the row is the tap area, the keyboard and a form work", () => {
    const change = vi.fn();
    render(
      <form>
        <Tick label="Which occasion it is for" sub="Asked on every call" name="q" defaultChecked onChange={change} />
        <Radio label="Right away" name="when" value="now" defaultChecked />
        <Radio label="Next morning" name="when" value="morning" />
      </form>,
    );
    const tick = screen.getByRole("checkbox", { name: /Which occasion it is for/ });
    expect(tick).toBeChecked();
    expect(screen.getByText("Asked on every call")).toBeInTheDocument();
    fireEvent.click(tick);
    expect(tick).not.toBeChecked();
    expect(change).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Next morning" }));
    expect(screen.getByRole("radio", { name: "Next morning" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Right away" })).not.toBeChecked();
    expect(tick.closest("label")).toHaveClass("min-h-11");
  });
});

describe("the skeleton", () => {
  it("is decorative and carries its size", () => {
    const { container } = render(<Skeleton className="h-4 w-2/3" />);
    const s = container.querySelector("[data-skeleton]") as HTMLElement;
    expect(s).toHaveAttribute("aria-hidden", "true");
    expect(s).toHaveClass("jb-skeleton", "h-4", "w-2/3");
  });
});

describe("the branded loading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    path = "/app/tenants/t";
    window.history.replaceState({}, "", "/app/tenants/t");
  });
  const link = (href: string, attrs: Record<string, string> = {}) => {
    const a = document.createElement("a");
    a.href = href;
    for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
    a.textContent = "go";
    document.body.appendChild(a);
    return a;
  };
  it("the orb breathes only after 300 ms: a fast page never flashes it", () => {
    render(<NavLoading />);
    fireEvent.click(link("/app/tenants/t/calls"));
    act(() => void vi.advanceTimersByTime(LOADING_AFTER_MS - 10));
    expect(document.documentElement).not.toHaveAttribute("data-nav-loading");
    act(() => void vi.advanceTimersByTime(20));
    expect(document.documentElement).toHaveAttribute("data-nav-loading");
  });
  it("stops when the address changes, and a page that opens in time never starts it", () => {
    const { rerender } = render(<NavLoading />);
    fireEvent.click(link("/app/tenants/t/chats"));
    act(() => void vi.advanceTimersByTime(400));
    expect(document.documentElement).toHaveAttribute("data-nav-loading");
    path = "/app/tenants/t/chats";
    rerender(<NavLoading />);
    expect(document.documentElement).not.toHaveAttribute("data-nav-loading");
    fireEvent.click(link("/app/tenants/t/leads"));
    window.history.replaceState({}, "", "/app/tenants/t/leads");
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.documentElement).not.toHaveAttribute("data-nav-loading");
  });
  it("ignores other sites, a new tab, a download, a modified click and the page you are on; gives up after 15 s", () => {
    render(<NavLoading />);
    for (const a of [link("https://other.example/x"), link("/app/tenants/t/x", { target: "_blank" }), link("/app/tenants/t/x", { download: "" }), link("/app/tenants/t")]) fireEvent.click(a);
    fireEvent.click(link("/app/tenants/t/y"), { metaKey: true });
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.documentElement).not.toHaveAttribute("data-nav-loading");
    fireEvent.click(link("/app/tenants/t/z"));
    act(() => void vi.advanceTimersByTime(500));
    expect(document.documentElement).toHaveAttribute("data-nav-loading");
    act(() => void vi.advanceTimersByTime(15_000));
    expect(document.documentElement).not.toHaveAttribute("data-nav-loading");
  });
  it("the brand mark shows once per session, is not a tap target, goes in under a second, and never shows for reduced motion", () => {
    sessionStorage.clear();
    const { container, rerender } = render(<FirstOpenMark />);
    act(() => void vi.advanceTimersByTime(1));
    const mark = container.querySelector('[data-part="first-open-mark"]');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    act(() => void vi.advanceTimersByTime(700));
    expect(container.querySelector('[data-part="first-open-mark"]')).toBeNull();
    rerender(<FirstOpenMark key="again" />);
    expect(container.querySelector('[data-part="first-open-mark"]')).toBeNull();
    sessionStorage.clear();
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
    const r = render(<BrandLoading />);
    expect(r.container.querySelector('[data-part="first-open-mark"]')).toBeNull();
  });
});
