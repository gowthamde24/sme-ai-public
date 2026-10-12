import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorScreen } from "./ErrorScreen";
import { LabelsProvider } from "./labels-context";
import { PROBLEM_KINDS, ProblemView } from "./ProblemView";
import { RefreshRetry, RetryButton, resetAutoTries } from "./RetryButton";
import { PageSkeleton, SLOW_AFTER_MS } from "./Skeleton";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  resetAutoTries();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the friendly pages", () => {
  it.each(PROBLEM_KINDS)("%s has the owl, one title, one sentence and a way back", (kind) => {
    const { container } = render(<ProblemView kind={kind} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Back to your workspaces" })).toHaveAttribute("href", "/app");
    expect(container.querySelector(`[data-problem="${kind}"]`)).not.toBeNull();
  });
  it("says each of the four in its own words", () => {
    const words = PROBLEM_KINDS.map((kind) => {
      const { unmount } = render(<ProblemView kind={kind} />);
      const text = screen.getByRole("heading", { level: 1 }).textContent;
      unmount();
      return text;
    });
    expect(words).toEqual(["This is not open to you", "Not found", "Too many tries", "Something went wrong on our side"]);
  });
  it("speaks the person's language, and shows a reference only when there is one", () => {
    render(<ProblemView kind={500} labels={{ "problem.500.title": "తప్పు జరిగింది", "problem.ref": "రిఫరెన్స్: {ref}" }} reference="abc123" />);
    expect(screen.getByRole("heading", { level: 1, name: "తప్పు జరిగింది" })).toBeInTheDocument();
    expect(screen.getByText("రిఫరెన్స్: abc123")).toBeInTheDocument();
    cleanup();
    render(<ProblemView kind={500} />);
    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});

describe("Try again", () => {
  it("runs what the page gave, at any moment", () => {
    const retry = vi.fn();
    render(<RetryButton onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("with auto it counts down, says so, and tries by itself", async () => {
    const retry = vi.fn();
    render(<RetryButton onRetry={retry} auto />);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Trying again in \d+ s/);
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
  it("tries by itself only twice inside a minute, however often the error screen is drawn again", async () => {
    const retry = vi.fn();
    for (let i = 0; i < 4; i += 1) {
      const { unmount } = render(<RetryButton onRetry={retry} auto />);
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      unmount();
    }
    expect(retry).toHaveBeenCalledTimes(2);
  });
  it("does not try by itself while the tab is hidden or the device is offline", async () => {
    const retry = vi.fn();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    render(<RetryButton onRetry={retry} auto />);
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(retry).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    cleanup();
    resetAutoTries();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    render(<RetryButton onRetry={retry} auto />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
  });
  it("the page version reloads the page", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(<RefreshRetry />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("the error screen", () => {
  it("is the 500 page with Try again that retries, the reference, and the frame's words", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const retry = vi.fn();
    const error = Object.assign(new Error("internal secret detail"), { digest: "d1g3st" });
    render(
      <LabelsProvider labels={{ "problem.500.title": "మా వైపు తప్పు" }}>
        <ErrorScreen error={error} retry={retry} />
      </LabelsProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "మా వైపు తప్పు" })).toBeInTheDocument();
    expect(screen.getByText(/d1g3st/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secret detail/); // the message is never shown
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(error);
  });
});

describe("the loading skeleton", () => {
  it("announces Loading once, hides its shapes from a screen reader, and is marked busy", () => {
    const { container } = render(<PageSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
  it("pulses only for people who have not asked for reduced motion", () => {
    const { container } = render(<PageSkeleton />);
    const shapes = [...container.querySelectorAll('[class*="bg-surface-2"]')];
    expect(shapes.length).toBeGreaterThan(5);
    for (const s of shapes) expect(s.className).toContain("motion-safe:animate-pulse");
  });
  it("says it is taking longer after eight seconds, and not before", async () => {
    render(<PageSkeleton />);
    await act(async () => {
      vi.advanceTimersByTime(SLOW_AFTER_MS - 100);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("status")).toHaveTextContent("This is taking longer than usual. Still trying.");
  });
  it("takes the frame's words from the context", () => {
    render(
      <LabelsProvider labels={{ "robust.loading": "లోడ్ అవుతోంది…" }}>
        <PageSkeleton />
      </LabelsProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("లోడ్ అవుతోంది…");
  });
});
