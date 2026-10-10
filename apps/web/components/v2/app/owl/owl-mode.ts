/** How Agent OWL is drawn: the 3D owl, or the flat SVG owl (moving, or still). The flat one is also what shows while the 3D chunk loads. */
export type OwlRender = "3d" | "svg" | "svg-still";

export type OwlEnv = {
  reducedMotion: boolean;
  /** `navigator.hardwareConcurrency`; undefined = the browser does not say, which is not treated as weak. */
  cores?: number;
  webgl: boolean;
};

/**
 * The flat owl, standing still, when the person asks for less motion (a static pose); the flat owl when WebGL is missing or the device is slow (two cores or fewer); else the 3D owl.
 * A WebGL context that fails to be created later is the same answer again (AgentOwl3D falls back to "svg" on its own).
 */
export function owlRender(env: OwlEnv): OwlRender {
  if (env.reducedMotion) return "svg-still";
  if (!env.webgl) return "svg";
  if (env.cores !== undefined && env.cores <= 2) return "svg";
  return "3d";
}
