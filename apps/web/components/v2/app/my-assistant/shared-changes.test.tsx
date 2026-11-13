import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { parseHowSpeaks, type HowSpeaks } from "@/lib/talk-training/speaks";
import type { TalkTrainingState } from "@/lib/talk-training/types";

import { TalkTraining } from "../assistant/TalkTraining";
import { TalkLiveBody } from "../ds/talk/TalkLive";
import { useTalkLive } from "../ds/talk/use-talk-live";

/** What My assistant added to two shared parts (each with a default that leaves the old behaviour as it was): "Hear it" + "Edit" beside the greeting and the Addresses choice beside "How your assistant speaks" in Talk training, and a slot under each line of the live transcript. */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const DOC = { greeting: { te: "నమస్కారం" }, address: "garu" as const, questions: [], neverSay: [], objections: [], examples: [], sayLike: [], introduceAs: null };
const STATE: TalkTrainingState = { training: DOC, defaults: DOC, saved: true, rules: [], updatedAt: null };
const lang = () => ({ style: "everyday_mixed", region: "neutral", saved: false, examples: "draft" });
const SPEAKS = parseHowSpeaks({
  tone: { value: "friendly", source: "pack_default", pack_default: "friendly", options: ["respectful", "friendly"] },
  words: { languages: { te: lang(), kn: lang(), hi: lang(), ta: lang(), en: lang(), ml: lang() }, options: { styles: ["everyday_mixed", "everyday_pure"] } },
  introduce_as: { kind: "business", text: null, options: ["business", "owner", "custom"], owner_name: null, preview: { te: "x", en: "y" } },
  pack_defaults: { tone: "friendly", words: "everyday_mixed", region: "neutral" },
  legacy_address: null,
  updated_at: null,
}) as HowSpeaks;
const draw = (over: Partial<Parameters<typeof TalkTraining>[0]> = {}) =>
  render(<TalkTraining initial={STATE} langNames={CALL_LANG_NAMES} canEdit securityHref="/app/security" actions={{ save: vi.fn(), reset: vi.fn() }} speaks={{ initial: SPEAKS, demo: true, save: vi.fn() }} {...over} />);

describe("Talk training in My assistant", () => {
  it("by default the Addresses choice is replaced by the tone (as before) and there is no Hear it", () => {
    draw();
    expect(document.querySelector('[data-part="tt-address"]')).toBeNull();
    expect(document.querySelector('[data-part="tt-greeting-hear"]')).toBeNull();
  });
  it("addressToo keeps garu / sir or madam / plainly (the working radios) beside the speaks panel", () => {
    draw({ addressToo: true });
    const address = document.querySelector('[data-part="tt-address"]') as HTMLElement;
    expect(address).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Garu/ })).toBeChecked();
    expect(document.querySelector('[data-part="sp-panel"]')).toBeInTheDocument();
  });
  it("Hear it plays the greeting through the workspace's voice-sample route in the language shown; again stops; Edit puts the cursor in the greeting", () => {
    const made: { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("Audio", function (this: (typeof made)[number], src: string) {
      this.src = src;
      this.play = vi.fn(async () => undefined);
      this.pause = vi.fn();
      made.push(this);
    });
    draw({ hearIt: { endpoint: "/app/tenants/t/voice-sample" } });
    fireEvent.click(screen.getByRole("button", { name: "▶ Hear it" }));
    expect(made[0].src).toBe("/app/tenants/t/voice-sample?voice=female_warm&lang=te&tone=warm");
    fireEvent.click(screen.getByRole("button", { name: "■ Stop" }));
    expect(made[0].pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Greeting"));
  });
  it("a person who cannot edit can hear it but gets no Edit", () => {
    vi.stubGlobal("Audio", function () {});
    draw({ hearIt: { endpoint: "/x" }, canEdit: false });
    expect(screen.getByRole("button", { name: "▶ Hear it" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("the live transcript's slot under a line", () => {
  beforeEach(() => vi.useFakeTimers());
  function Harness({ slot }: { slot: boolean }) {
    const live = useTalkLive("practice");
    return (
      <>
        <button type="button" onClick={live.start}>
          begin
        </button>
        {live.active ? <TalkLiveBody live={live} words={appDict("en") as Record<string, string>} language="English" onType={() => undefined} afterLine={slot ? (l, i) => <i data-slot={`${l.who}-${i}`} /> : null} /> : null}
      </>
    );
  }
  it("is called once for every line, with its place, and draws nothing by default", () => {
    const { unmount } = render(<Harness slot />);
    fireEvent.click(screen.getByText("begin"));
    act(() => void vi.advanceTimersByTime(3500));
    expect([...document.querySelectorAll("[data-slot]")].map((n) => n.getAttribute("data-slot"))).toEqual(["owner-0", "assistant-1"]);
    unmount();
    render(<Harness slot={false} />);
    fireEvent.click(screen.getByText("begin"));
    act(() => void vi.advanceTimersByTime(3500));
    expect(document.querySelector("[data-slot]")).toBeNull();
    expect(document.querySelectorAll("[data-who]")).toHaveLength(2);
  });
});
