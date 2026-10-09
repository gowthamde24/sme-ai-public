import { describe, expect, it } from "vitest";
import { NEAR_SEAT_RADIUS, SEATS, SEAT_RADIUS, angleDiff } from "./seats";
import { ALL_AGENT_IDS } from "./ids";

describe("seats", () => {
  it("every agent has a seat on the circle (the two swivelled seats sit a little closer in)", () => {
    for (const id of ALL_AGENT_IDS) {
      const r = Math.hypot(SEATS[id].x, SEATS[id].z);
      expect(r).toBeCloseTo(SEATS[id].swivel === 0 ? SEAT_RADIUS : NEAR_SEAT_RADIUS, 5);
    }
  });
  it("the main agent sits at the far side and faces the camera (+z)", () => {
    expect(SEATS.main.x).toBeCloseTo(0);
    expect(SEATS.main.z).toBeCloseTo(-SEAT_RADIUS);
    expect(SEATS.main.yaw).toBeCloseTo(0);
  });
  it("the near side stays open: no seat is directly in front of the camera", () => {
    for (const id of ALL_AGENT_IDS) expect(SEATS[id].z).toBeLessThan(SEAT_RADIUS * 0.7);
  });
  it("the six teammates are spread evenly left and right", () => {
    const xs = ALL_AGENT_IDS.filter((i) => i !== "main").map((i) => SEATS[i].x);
    expect(xs.filter((x) => x < 0)).toHaveLength(3);
    expect(xs.filter((x) => x > 0)).toHaveLength(3);
  });
  it("angleDiff wraps to the shortest turn", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2);
  });
});
