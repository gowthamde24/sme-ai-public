import type { Pose } from "./ids";

/** The API's state of one helper, as the board gets it. */
export type ApiState = "idle" | "working" | "switched_off" | "not_available";

/** What the board draws for a helper (the pose mapping; no event stream and no hand-offs of its own): working pulses, idle is calm, off is faded and still. */
export const poseOf = (s: ApiState): Pose => (s === "working" ? "working" : s === "idle" ? "idle" : "off");
