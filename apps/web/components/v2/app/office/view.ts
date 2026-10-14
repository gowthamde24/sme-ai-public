export type View = "room" | "list";

export const VIEW_KEY = "sme_office_view";

/**
 * The bits of the browser the Office needs (job CJ: the room is plain DOM and CSS, so every device can draw it; nothing here decides whether it CAN): `lite` is a person who asked for less (reduced motion, the data
 * saver, a 2G or 3G connection): the owls are still pictures, so no layer file is fetched and nothing moves. `remembered` is the view the person chose last time, in this browser only.
 */
export type ClientEnv = { reducedMotion: boolean; lite: boolean; remembered: View | null };

type Nav = Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };

/** Only a person who asked for less, or a connection that is clearly slow, gets stills. Pure: the browser's answers are passed in. */
export function isLite(env: { reducedMotion: boolean; saveData?: boolean; effectiveType?: string }): boolean {
  return env.reducedMotion || env.saveData === true || (env.effectiveType !== undefined && /^(slow-2g|2g|3g)$/.test(env.effectiveType));
}

/** Read once on the client (the server draws the room with still pictures, which every device can show). The remembered choice lives only in this browser; blocked storage just means "none". */
export function readClientEnv(): ClientEnv {
  const nav = navigator as Nav;
  const reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  let remembered: View | null = null;
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    remembered = v === "room" || v === "list" ? v : null; // "3d" (the old view's name) is simply forgotten: the room is the default
  } catch {
    /* storage blocked: nothing is remembered */
  }
  return { reducedMotion, lite: isLite({ reducedMotion, saveData: nav.connection?.saveData, effectiveType: nav.connection?.effectiveType }), remembered };
}

export function rememberView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* storage blocked: the choice just is not remembered */
  }
}
