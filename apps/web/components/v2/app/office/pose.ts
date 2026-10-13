import type { OwlMood } from "../owl/owl-mood";
import type { Pose } from "./ids";

/** The API's state of one helper, as the room gets it. */
export type ApiState = "idle" | "working" | "switched_off" | "not_available";

/** What the Office draws for a helper (the pose mapping of the room; no event stream and no hand-offs of its own): working types at a glowing laptop, idle breathes and blinks, off is faded and still. */
export const poseOf = (s: ApiState): Pose => (s === "working" ? "working" : s === "idle" ? "idle" : "off");

/**
 * How one owl of the room is given to PlushOwl. `still`: the stills only (no layer is fetched, nothing moves): a helper that is off, and everyone when the person asked for less motion or less data (`lite`).
 * `working`: the typing pose (not with `lite`: the still pose of a working helper is the picture and the lit laptop). `laptop`: a working helper has the glowing laptop whatever the motion setting.
 * `faded`: off helpers are drawn at 45 % opacity (the opacity-45 class).
 */
export type OwlDraw = { mood: OwlMood; still: boolean; working: boolean; laptop: boolean; faded: boolean };
export function drawOf(pose: Pose, lite: boolean): OwlDraw {
  if (pose === "off") return { mood: "idle", still: true, working: false, laptop: false, faded: true };
  if (pose === "working") return { mood: "idle", still: lite, working: !lite, laptop: true, faded: false };
  return { mood: "idle", still: lite, working: false, laptop: false, faded: false };
}
