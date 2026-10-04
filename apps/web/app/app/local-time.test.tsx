import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalTime, relativeText, utcText } from "./local-time";

describe("local time", () => {
  afterEach(() => vi.useRealTimers());

  it("formats the server's first paint in UTC", () => {
    expect(utcText("2026-10-04T21:57:12+00:00")).toBe("2026-10-04 21:57 UTC");
  });

  it("describes how long ago something was, in words", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(relativeText("2026-10-04T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeText("2026-10-02T12:00:00Z", now)).toBe("2 days ago");
    expect(relativeText("2026-10-04T12:10:00Z", now)).toBe("in 10 minutes");
    expect(relativeText("nonsense", now)).toBe("");
  });

  it("shows the viewer's own timezone after load, keeps the UTC time in the tooltip and a machine-readable datetime", async () => {
    render(<LocalTime iso="2026-10-04T21:57:12+00:00" />);
    const el = screen.getByText(/2026|Oct/);
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("datetime", "2026-10-04T21:57:12+00:00");
    expect(el).toHaveAttribute("title", "2026-10-04 21:57 UTC");
    await waitFor(() => expect(el.textContent).toMatch(/ago|in \d/));
  });

  it("leaves the UTC text when the value is not a date", () => {
    render(<LocalTime iso="nonsense" />);
    expect(screen.getByText(/nonsense/)).toBeInTheDocument();
  });
});
