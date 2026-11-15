import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const frame = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../../frame-store", () => ({ useFrameData: () => frame.value }));

import { appDict } from "@/i18n/app";

import { LightNote, useLightUntil } from "./LightNote";

const words = appDict("en") as Record<string, string>;
const usage = (state: string, over: Record<string, unknown> = {}) => ({ state, today_percent: 100, month_percent: 40, resets_at_today: "2026-11-15T18:30:00.000Z", resets_at_month: "2026-12-01T18:30:00.000Z", ...over });

function Probe() {
  const until = useLightUntil();
  return <LightNote words={words} until={until} />;
}

afterEach(cleanup);

describe("the light mode line next to the composer", () => {
  it("says the same sentence as the banner when the assistant is in light mode", () => {
    frame.value = { showUsage: true, usage: usage("light") };
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Light mode until 16 Nov,? 12:00\s?am$/i);
  });

  it("uses the month's reset when the month is the full window", () => {
    frame.value = { showUsage: true, usage: usage("light", { today_percent: 30, month_percent: 100 }) };
    render(<Probe />);
    expect(screen.getByRole("status")).toHaveTextContent(/Light mode until 2 Dec/i);
  });

  it.each([
    ["ok", { showUsage: true, usage: usage("ok", { today_percent: 10 }) }],
    ["warn", { showUsage: true, usage: usage("warn", { today_percent: 85 }) }],
    ["paused", { showUsage: true, usage: usage("paused") }],
    ["no usage read", { showUsage: true, usage: null }],
    ["a person the API gives no usage to", { showUsage: false, usage: usage("light") }],
    ["no frame data", {}],
  ])("draws nothing for %s", (_n, value) => {
    frame.value = value as Record<string, unknown>;
    const { container } = render(<Probe />);
    expect(container).toBeEmptyDOMElement();
  });
});
