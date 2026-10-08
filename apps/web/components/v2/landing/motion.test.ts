import { describe, expect, it } from "vitest";
import {
  LOOP_MS,
  NODE_COUNT,
  PHASE_COUNT,
  PHASE_MS,
  SLIDE_MS,
  TOUCH_PAUSE_MS,
  cardVisible,
  lineProgress,
  lineStep,
  motionAllowed,
  nextPhase,
  nodeAt,
  nodeDone,
  shouldPlay,
  slideAt,
  type PlayInputs,
} from "@/components/v2/landing/motion";

const base: PlayInputs = { reduced: false, forceMotion: false, inView: true, tabVisible: true, userPaused: false, touchPaused: false };

describe("the hero flow's playback rules", () => {
  it("plays by itself: nothing needs to be clicked or scrolled", () => {
    expect(shouldPlay(base)).toBe(true);
  });
  it("pauses off-screen, in a hidden tab, by the pause icon, and after a touch", () => {
    expect(shouldPlay({ ...base, inView: false })).toBe(false);
    expect(shouldPlay({ ...base, tabVisible: false })).toBe(false);
    expect(shouldPlay({ ...base, userPaused: true })).toBe(false);
    expect(shouldPlay({ ...base, touchPaused: true })).toBe(false);
  });
  it("under reduced motion it never plays, unless the visitor chooses Play motion", () => {
    for (const inView of [true, false])
      for (const tabVisible of [true, false])
        for (const userPaused of [true, false]) for (const touchPaused of [true, false])
          expect(shouldPlay({ reduced: true, forceMotion: false, inView, tabVisible, userPaused, touchPaused })).toBe(false);
    expect(motionAllowed({ reduced: true, forceMotion: false })).toBe(false);
    expect(motionAllowed({ reduced: true, forceMotion: true })).toBe(true);
    expect(shouldPlay({ ...base, reduced: true, forceMotion: true })).toBe(true);
    // and even then the other pauses still win
    expect(shouldPlay({ ...base, reduced: true, forceMotion: true, inView: false })).toBe(false);
  });
});

describe("the loop", () => {
  it("lasts 14 to 18 seconds, and the swipe row too", () => {
    expect(LOOP_MS).toBeGreaterThanOrEqual(14000);
    expect(LOOP_MS).toBeLessThanOrEqual(18000);
    expect(SLIDE_MS * NODE_COUNT).toBeGreaterThanOrEqual(14000);
    expect(SLIDE_MS * NODE_COUNT).toBeLessThanOrEqual(18000);
  });
  it("visits phases 0..7 in order and wraps", () => {
    let p = 0;
    const seen: number[] = [];
    for (let i = 0; i < PHASE_COUNT; i++) {
      seen.push(p);
      p = nextPhase(p);
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(p).toBe(0);
    expect(PHASE_MS).toHaveLength(PHASE_COUNT);
  });
  it("the enquiry sits at node 0..5 and rests on the last node while everything is held", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(nodeAt)).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
  });
  it("a mini-card appears when the enquiry arrives and stays until the fade-out", () => {
    expect(cardVisible(0, 0)).toBe(true);
    expect(cardVisible(1, 0)).toBe(false);
    expect(cardVisible(3, 3)).toBe(true);
    expect(cardVisible(4, 3)).toBe(false);
    for (let i = 0; i < NODE_COUNT; i++) expect(cardVisible(i, 6), `held: card ${i}`).toBe(true); // all six shown together
    for (let i = 0; i < NODE_COUNT; i++) expect(cardVisible(i, 7), `fade-out: card ${i}`).toBe(false);
  });
  it("a node shows its tick once the enquiry has moved on", () => {
    expect(nodeDone(0, 0)).toBe(false);
    expect(nodeDone(0, 1)).toBe(true);
    expect(nodeDone(5, 5)).toBe(false);
    expect(nodeDone(5, 6)).toBe(true);
    expect(nodeDone(2, 7)).toBe(false);
  });
  it("the line fills from 0 to 1 as the enquiry travels, and empties for the next loop", () => {
    expect(lineProgress(0)).toBe(0);
    expect(lineProgress(5)).toBe(1);
    expect(lineProgress(6)).toBe(1);
    expect(lineProgress(7)).toBe(0);
    for (let p = 1; p <= 5; p++) expect(lineProgress(p)).toBeGreaterThanOrEqual(lineProgress(p - 1));
  });
});

describe("the line's steps", () => {
  it("has six steps 0..5 that match lineProgress", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(lineStep)).toEqual([0, 1, 2, 3, 4, 5, 5, 0]);
    for (let p = 0; p < PHASE_COUNT; p++) expect(lineStep(p) / (NODE_COUNT - 1)).toBeCloseTo(lineProgress(p), 5);
  });
});

describe("the swipe row (tablet and phone)", () => {
  it("a touch pauses auto-advance for a while, not for ever", () => {
    expect(TOUCH_PAUSE_MS).toBeGreaterThanOrEqual(8000);
    expect(TOUCH_PAUSE_MS).toBeLessThanOrEqual(20000);
  });
  it("maps a scroll position to the slide being shown, clamped to six slides", () => {
    expect(slideAt(0, 300)).toBe(0);
    expect(slideAt(310, 300)).toBe(1);
    expect(slideAt(740, 300)).toBe(2);
    expect(slideAt(99999, 300)).toBe(5);
    expect(slideAt(-50, 300)).toBe(0);
    expect(slideAt(500, 0)).toBe(0);
  });
});
