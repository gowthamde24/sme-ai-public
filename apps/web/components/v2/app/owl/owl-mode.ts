/** How Agent OWL is drawn: the 3D owl, or the flat SVG owl (moving, or still). The flat one is also what shows while the 3D chunk loads. */
export type OwlRender = "3d" | "svg" | "svg-still";

export type OwlEnv = {
  reducedMotion: boolean;
  /** `navigator.hardwareConcurrency`; undefined = the browser does not say, which is not treated as weak. */
  cores?: number;
  webgl: boolean;
  /** `navigator.connection.saveData`: the person asked for less data. */
  saveData?: boolean;
  /** `navigator.connection.effectiveType`: "slow-2g", "2g", "3g" or "4g". */
  effectiveType?: string;
  /** `navigator.deviceMemory` in GB (Chromium only); undefined = not said, which is not treated as weak. */
  deviceMemory?: number;
};

/** The connections on which the 3D owl (about 190 KB gzip of three.js) is not worth downloading. */
const SLOW_CONNECTION = /^(slow-2g|2g|3g)$/;

/**
 * The flat owl, standing still, when the person asks for less motion (a static pose); the flat owl, and three.js never downloaded, when WebGL is missing, the device is slow (two cores or
 * fewer, or 2 GB of memory or less), the person has the data saver on, or the connection is slow-2g, 2g or 3g; else the 3D owl.
 * A WebGL context that fails to be created later is the same answer again (AgentOwl3D falls back to "svg" on its own).
 */
export function owlRender(env: OwlEnv): OwlRender {
  if (env.reducedMotion) return "svg-still";
  if (!env.webgl) return "svg";
  if (env.cores !== undefined && env.cores <= 2) return "svg";
  if (env.deviceMemory !== undefined && env.deviceMemory <= 2) return "svg";
  if (env.saveData === true) return "svg";
  if (env.effectiveType !== undefined && SLOW_CONNECTION.test(env.effectiveType)) return "svg";
  return "3d";
}
