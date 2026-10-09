import { webglAvailable } from "./webgl";

export type View = "3d" | "list";

/** The bits of the browser that decide whether the 3D room is a good default. Every field is optional: a browser that does not say is not treated as weak. */
export type Environment = {
  reducedMotion: boolean;
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  cores?: number;
};

/**
 * Which view is shown first. The List, unless this device can clearly run the room: no request for less motion (the room would only be a still picture), no data-saver, a
 * connection better than 3G, more than 4 GB of memory and more than 4 cores where the browser says so. The person can always press "3D view" (they are only told when WebGL is missing).
 */
export function defaultView(env: Environment): { view: View; weak: boolean } {
  const weak =
    env.reducedMotion ||
    env.saveData === true ||
    (env.effectiveType !== undefined && /^(slow-2g|2g|3g)$/.test(env.effectiveType)) ||
    (env.deviceMemory !== undefined && env.deviceMemory <= 4) ||
    (env.cores !== undefined && env.cores <= 4);
  return { view: weak ? "list" : "3d", weak };
}

type Nav = Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };

export const VIEW_KEY = "sme_office_view";

export type ClientEnv = { defaultView: View; weak: boolean; webgl: boolean; reducedMotion: boolean; remembered: View | null; coarse: boolean; phone: boolean };

/** Read once on the client (the server draws the List, which every device can show). The remembered choice lives only in this browser; blocked storage just means "none". */
export function readClientEnv(): ClientEnv {
  const nav = navigator as Nav;
  const mq = (q: string) => (typeof window.matchMedia === "function" ? window.matchMedia(q).matches : false);
  const reducedMotion = mq("(prefers-reduced-motion: reduce)");
  const { view, weak } = defaultView({ reducedMotion, saveData: nav.connection?.saveData, effectiveType: nav.connection?.effectiveType, deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency });
  let remembered: View | null = null;
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    remembered = v === "3d" || v === "list" ? v : null;
  } catch {
    /* storage blocked: nothing is remembered */
  }
  return { defaultView: view, weak, webgl: webglAvailable(), reducedMotion, remembered, coarse: mq("(pointer: coarse)"), phone: mq("(max-width: 767px)") };
}

export function rememberView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}
