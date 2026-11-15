import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useTalkLive = vi.hoisted(() => vi.fn());
vi.mock("../ds/talk/use-talk-live", () => ({ useTalkLive: (...a: unknown[]) => useTalkLive(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PracticePanel } from "./PracticePanel";

const idle = { active: false, start: vi.fn(), end: vi.fn(), finished: false, state: "listening", seconds: 0, lines: [], plan: null, answer: null, muted: false, toggleMute: vi.fn(), decide: vi.fn() };
const draw = (over: Partial<Parameters<typeof PracticePanel>[0]> = {}) => render(<PracticePanel language="en" langName="English" practice={null} teach={null} testCallHref={null} {...over} />);

afterEach(() => {
  cleanup();
  useTalkLive.mockReset();
});

describe("the Practice conversation starts in the business's own language (owner, 15 Nov: it started in English, so Telugu got the English voice)", () => {
  it("Telugu ticked: the live conversation is started in Telugu with the recogniser pinned to it", () => {
    useTalkLive.mockReturnValue(idle);
    draw({ voiceLanguage: "te" });
    expect(useTalkLive).toHaveBeenCalledWith("practice", { language: "te", stt: "te" });
  });
  it("no business language known, or one the voice does not speak: the app's language, detecting, as before", () => {
    useTalkLive.mockReturnValue(idle);
    draw({ voiceLanguage: null });
    draw({ voiceLanguage: "xx" });
    for (const call of useTalkLive.mock.calls) expect(call).toEqual(["practice", {}]);
  });
  it("the typed practice speaks the same language as the call", async () => {
    useTalkLive.mockReturnValue(idle);
    const practice = vi.fn(async () => ({ ok: true as const, reply: "ok", ended: false, escalated: false }));
    draw({ voiceLanguage: "te", practice: practice as never });
    const input = document.getElementById("mya-practice-in") as HTMLInputElement;
    expect(input).toHaveAttribute("lang", "te");
  });
});
