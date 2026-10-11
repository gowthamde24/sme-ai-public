import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { FreshPhotos } from "./FreshPhotos";
import { MessagePhotos } from "./MessagePhotos";
import { Photo, shapeClass } from "./Photo";
import { WORDS } from "./catalogue-test-kit";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T04:30:00Z"));
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const photo = (src: string | null = "https://s.example/a.jpg?token=1") => <Photo src={src} width={640} height={800} alt="A saree" words={WORDS} />;
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe("a photo", () => {
  it("has its box before it loads and loads lazily; the first on a screen is eager and high priority", () => {
    const { rerender } = render(photo());
    const img = screen.getByAltText("A saree");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "640");
    expect(img).toHaveAttribute("height", "800");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img.parentElement?.className).toContain("aspect-[4/5]");
    rerender(<Photo src="https://s.example/a.jpg" width={640} height={800} alt="A saree" words={WORDS} eager />);
    expect(screen.getByAltText("A saree")).toHaveAttribute("loading", "eager");
    expect(screen.getByAltText("A saree")).toHaveAttribute("fetchpriority", "high");
  });

  it("the box shape is one of four known proportions, so the style sheet knows them and nothing jumps", () => {
    expect(shapeClass("card", 1, 1)).toBe("aspect-[4/5]");
    expect(shapeClass("square", 1, 2)).toBe("aspect-square");
    expect(shapeClass("natural", 600, 800)).toBe("aspect-[3/4]");
    expect(shapeClass("natural", 640, 800)).toBe("aspect-[4/5]");
    expect(shapeClass("natural", 1000, 1000)).toBe("aspect-square");
    expect(shapeClass("natural", 2000, 1000)).toBe("aspect-[6/5]");
  });

  it("no link: says 'No photo' in the box; a link that fails to load says 'Photo not available' and asks the page to read its links again", () => {
    const { rerender } = render(photo(null));
    expect(screen.getByText("No photo")).toBeInTheDocument();
    rerender(photo());
    fireEvent.error(screen.getByAltText("A saree"));
    expect(screen.getByText("Photo not available")).toBeInTheDocument();
    expect(screen.queryByAltText("A saree")).toBeNull();
  });

  it("a fresh link for the same photo is tried again after a failure", () => {
    const { rerender } = render(photo("https://s.example/a.jpg?token=old"));
    fireEvent.error(screen.getByAltText("A saree"));
    expect(screen.getByText("Photo not available")).toBeInTheDocument();
    rerender(photo("https://s.example/a.jpg?token=new"));
    expect(screen.getByAltText("A saree")).toHaveAttribute("src", "https://s.example/a.jpg?token=new");
  });
});

describe("links that run out are fetched again before they do", () => {
  it("reads the page again at three quarters of the shortest life (600 s: every 450 s), and again after that", async () => {
    render(<FreshPhotos seconds={600}>{photo()}</FreshPhotos>);
    await advance(449_000);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(450_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no photo is on the page, and never faster than every 30 seconds", async () => {
    const { unmount } = render(<FreshPhotos seconds={null}>{photo()}</FreshPhotos>);
    await advance(3_600_000);
    expect(refresh).not.toHaveBeenCalled();
    unmount();
    render(<FreshPhotos seconds={5}>{photo()}</FreshPhotos>);
    await advance(29_000);
    expect(refresh).not.toHaveBeenCalled();
    await advance(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh a tab nobody is looking at, and refreshes at once when it comes back after the time is up", async () => {
    let state: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    render(<FreshPhotos seconds={600}>{photo()}</FreshPhotos>);
    await advance(900_000);
    expect(refresh).not.toHaveBeenCalled();
    state = "visible";
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a photo that fails to load asks for a refresh, but at most once every 20 seconds", async () => {
    render(
      <FreshPhotos seconds={600}>
        <Photo src="https://s.example/1.jpg" width={4} height={5} alt="one" words={WORDS} />
        <Photo src="https://s.example/2.jpg" width={4} height={5} alt="two" words={WORDS} />
      </FreshPhotos>,
    );
    fireEvent.error(screen.getByAltText("one")); // a link that was already dead when the page came: no waiting
    fireEvent.error(screen.getByAltText("two"));
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(21_000);
    cleanup();
  });
});

describe("the photos a message carries", () => {
  it("shows them small, in order, with words for a screen reader; nothing when there are none", () => {
    const { container, rerender } = render(<MessagePhotos media={[{ position: 1, thumb_url: "https://s.example/1.jpg" }, { position: 2, thumb_url: null }]} words={WORDS} />);
    expect(screen.getByAltText("Photo 1 of 2 sent with this message")).toHaveAttribute("src", "https://s.example/1.jpg");
    expect(screen.getByText("No photo")).toBeInTheDocument();
    rerender(<MessagePhotos media={[]} words={WORDS} />);
    expect(container).toBeEmptyDOMElement();
  });
});
