import { MESSAGE_KEY } from "./fixtures";

/**
 * The story of the demo video (job demo-video), as BEATS the presenter moves through: eight steps, some in two or three beats (a button press inside a step). Pure: no React, no request.
 * - `screen`: which real screen is drawn (Today in one of its phases, the WhatsApp chat, Prospects).
 * - `target`: the ONE thing the presenter clicks in this beat (a CSS selector inside the stage). Only it reacts to a click; every other button and link of the stage is held still, so a slip of the mouse never leaves the story.
 *   The "next" key clicks it for the presenter. No target: a click on the page (or the "next" key) goes to the next beat.
 * - `on`: what ends a beat with a target: `click` (the click itself: a row that opens, a part that unfolds) or `action` (the fake answer of the button, e.g. the approval, the search, the call: the beat moves on when it is back).
 * - `auto`: the beat moves on by itself after so many ms (the short beat between the approval on Today and the chat).
 */
export type Screen = "today-calm" | "today-lead" | "chat" | "prospects" | "today-done";
export type Beat = { id: string; step: number; screen: Screen; target?: string; on?: "click" | "action"; auto?: number };

export const BEATS: readonly Beat[] = [
  { id: "today", step: 1, screen: "today-calm" },
  { id: "lead", step: 2, screen: "today-lead", target: `[data-needs-row="${MESSAGE_KEY}"] [title]`, on: "click" },
  { id: "reply", step: 3, screen: "today-lead", target: `#needs-full-${MESSAGE_KEY} [data-needs="approve"]`, on: "action" },
  { id: "sent", step: 4, screen: "today-lead", auto: 1400 },
  { id: "chat", step: 4, screen: "chat" },
  { id: "finder", step: 5, screen: "prospects", target: "[data-finder] button[type=submit]", on: "action" },
  { id: "plan", step: 5, screen: "prospects", target: "[data-plan-ok]", on: "action" },
  { id: "found", step: 5, screen: "prospects" },
  { id: "call", step: 6, screen: "prospects", target: "[data-practice] > summary", on: "click" },
  { id: "start", step: 6, screen: "prospects", target: "[data-practice-start]", on: "action" },
  { id: "quote", step: 7, screen: "prospects", target: "[data-draft-make]", on: "action" },
  { id: "made", step: 7, screen: "prospects", target: "[data-draft-open]", on: "click" },
  { id: "done", step: 8, screen: "today-done" },
];
export const STEPS = 8;

export const beatIndex = (id: string): number => BEATS.findIndex((b) => b.id === id);
/** The beat after `index` (the last one stays where it is: the story ends on "Done while you slept"). */
export const nextIndex = (index: number): number => Math.min(index + 1, BEATS.length - 1);

/** What a key does: `next` (the arrow, Page Down from a presenter's clicker, or N), `reset` (R or Home: back to step 1 at once), `leave` (Escape: the normal Today). Anything with Ctrl, Alt or Cmd is the browser's. */
export type KeyMove = "next" | "reset" | "leave" | null;
export function keyMove(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">): KeyMove {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "n" || e.key === "N") return "next";
  if (e.key === "r" || e.key === "R" || e.key === "Home") return "reset";
  if (e.key === "Escape") return "leave";
  return null;
}

/** What the story's screens look at first in a beat: the target, or the part the beat is about (scrolled into view when it is not on screen). */
export const FOCUS: Readonly<Record<string, string>> = {
  sent: "#needs-you",
  chat: '[data-chat="thread"] ol > li:last-child',
  found: "[data-result-card]",
  done: '[data-part="done"]',
};
