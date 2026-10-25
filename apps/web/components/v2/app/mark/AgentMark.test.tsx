import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentMark, HELPER_AGENTS, HELPER_ICONS, orbStateOf } from "./AgentMark";
import { AgentOrb } from "./AgentOrb";
import { PersonMark, PERSON_TINTS, tintOf } from "./PersonMark";
import { WORKERS, WORKER_ICONS } from "./workers";
import { AGENT_KEYS } from "@/lib/api/today";

describe("AgentMark: who is speaking", () => {
  it("the main assistant is the AI circle; each of the six helpers is the icon of its job on a tile; none is a picture", () => {
    expect(render(<AgentMark />).container.querySelector("[data-orb]")).not.toBeNull();
    for (const a of HELPER_AGENTS) {
      const { container, unmount } = render(<AgentMark agent={a} px={48} />);
      expect(container.querySelector(`[data-agent-mark="${a}"]`), a).not.toBeNull();
      expect(container.querySelector("svg"), a).not.toBeNull();
      expect(container.querySelector("img")).toBeNull();
      unmount();
    }
  });
  it("knows exactly the API's six helpers, in the order of the six steps of the old flow, and an unknown agent is the circle (never a broken picture)", () => {
    expect(Object.keys(HELPER_ICONS).sort()).toEqual(AGENT_KEYS.filter((k) => k !== "main").sort());
    expect(render(<AgentMark agent="nobody" />).container.querySelector("[data-orb]")).not.toBeNull();
  });
  it("a helper that is off is faded", () => {
    expect(render(<AgentMark agent="researcher" off />).container.innerHTML).toContain("opacity-45");
    expect(render(<AgentMark off />).container.innerHTML).toContain("opacity-45");
  });
  it("the circle follows the mood: thinking and listening think, answering speaks, the rest is still", () => {
    expect([orbStateOf("thinking"), orbStateOf("listening"), orbStateOf("answering"), orbStateOf("idle"), orbStateOf("resting"), orbStateOf(undefined)]).toEqual(["think", "think", "speak", "still", "still", "still"]);
  });
});

describe("AgentOrb: the assistant where it talks", () => {
  it("carries the name and the mood as text and a polite live region, and the halo while it answers", () => {
    const a = render(<AgentOrb mood="answering" name="Vijaya" moodText="Answering" />).container;
    expect(a.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Vijaya, Answering");
    expect(a.querySelector('[role="img"]')!.getAttribute("data-mood")).toBe("answering");
    expect(a.querySelector(".orb-halo")).not.toBeNull();
    expect(a.querySelector('[aria-live="polite"]')!.textContent).toBe("Answering");
    expect(render(<AgentOrb mood="idle" name="x" moodText="y" />).container.querySelector(".orb-halo")).toBeNull();
  });
});

describe("the six workers and the people", () => {
  it("six workers in the order of the workflow, each with its icon", () => {
    expect(WORKERS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(WORKER_ICONS).toHaveLength(6);
  });
  it("a person gets the same tint every time, one of four, and a circle with their first letter", () => {
    expect(tintOf("u1")).toBe(tintOf("u1"));
    expect(PERSON_TINTS).toHaveLength(4);
    const { container } = render(<PersonMark userId="u1" name="  asha" />);
    expect(container.textContent).toBe("A");
    expect(container.querySelector("[data-person-mark]")!.getAttribute("aria-hidden")).toBe("true");
  });
});
