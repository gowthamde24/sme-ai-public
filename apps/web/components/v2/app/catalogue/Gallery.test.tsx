import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { Gallery, slideRatio } from "./Gallery";
import { WORDS, item } from "./catalogue-test-kit";

afterEach(cleanup);

describe("the saree's photos", () => {
  it("is a carousel with one labelled slide per photo; the big picture (not the thumbnail) is the slide, the first at once", () => {
    const it3 = item();
    render(<Gallery photos={it3.photos} name={it3.name} words={WORDS} />);
    const region = screen.getByRole("region", { name: "Photos of DEMO Maroon Kanchi pattu" });
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    const slides = within(region).getAllByRole("group");
    expect(slides.map((s) => s.getAttribute("aria-label"))).toEqual(["Photo 1 of 3", "Photo 2 of 3", "Photo 3 of 3"]);
    const imgs = slides.map((s) => s.querySelector("img")!);
    expect(imgs.map((i) => i.getAttribute("loading"))).toEqual(["eager", "lazy", "lazy"]);
    expect(imgs[0].getAttribute("src")).not.toContain("_t.jpg");
    expect(imgs[0].getAttribute("src")).toContain(it3.photos[0].id);
    expect(imgs[0].parentElement?.className).toMatch(/aspect-/);
  });

  it("swipes by the browser's own scroll-snap, and says which photo is showing", () => {
    const it3 = item();
    render(<Gallery photos={it3.photos} name="X" words={WORDS} />);
    const slides = screen.getByRole("region").querySelector("[data-part=slides]") as HTMLElement;
    expect(slides.className).toContain("snap-x");
    expect(slides.className).toContain("overflow-x-auto");
    expect(screen.getByText("Photo 1 of 3", { selector: "p" })).toBeInTheDocument();
    Object.defineProperty(slides, "clientWidth", { value: 300, configurable: true });
    slides.scrollLeft = 600;
    fireEvent.scroll(slides);
    expect(screen.getByText("Photo 3 of 3", { selector: "p" })).toBeInTheDocument();
  });

  it("has previous and next buttons, thumbnails to jump to a photo, and the arrow keys", () => {
    const it3 = item();
    render(<Gallery photos={it3.photos} name="X" words={WORDS} />);
    const slides = screen.getByRole("region").querySelector("[data-part=slides]") as HTMLElement;
    const scrollTo = vi.fn();
    slides.scrollTo = scrollTo as never;
    Object.defineProperty(slides, "clientWidth", { value: 300, configurable: true });
    const prev = screen.getByRole("button", { name: "Previous photo" });
    const next = screen.getByRole("button", { name: "Next photo" });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ left: 300 }));
    expect(screen.getByText("Photo 2 of 3", { selector: "p" })).toBeInTheDocument();
    fireEvent.keyDown(slides, { key: "ArrowRight" });
    expect(screen.getByText("Photo 3 of 3", { selector: "p" })).toBeInTheDocument();
    expect(next).toBeDisabled();
    fireEvent.keyDown(slides, { key: "ArrowLeft" });
    expect(screen.getByText("Photo 2 of 3", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show photo 1" }));
    expect(screen.getByText("Photo 1 of 3", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 1" })).toHaveAttribute("aria-current", "true");
    for (const b of [prev, next]) expect(b.className).toContain("size-11");
  });

  it("one photo has no buttons or thumbnails; none says so", () => {
    const one = item({}, [item().photos[0] as never]);
    const { rerender } = render(<Gallery photos={one.photos} name="X" words={WORDS} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<Gallery photos={[]} name="X" words={WORDS} />);
    expect(screen.getByText("This saree has no photo yet.")).toBeInTheDocument();
  });

  it("every slide has the box of the first photo, never thinner than 3:4 or wider than 6:5", () => {
    expect(slideRatio({ width: 640, height: 800 })).toEqual({ width: 800, height: 1000 });
    expect(slideRatio({ width: 100, height: 1000 })).toEqual({ width: 750, height: 1000 });
    expect(slideRatio({ width: 4000, height: 1000 })).toEqual({ width: 1200, height: 1000 });
  });
});
