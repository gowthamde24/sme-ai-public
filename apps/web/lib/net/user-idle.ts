/**
 * A tab that is in front but untouched (left open on a desk overnight) still asked the API every few seconds. After this long without a pointer, key, wheel, touch or scroll on the page, the background polls (the live strip, the live-call bar, the
 * menu's numbers) stop asking; the first touch after it starts them again at once (`whenUserBack`). A tab behind others already stops asking; this is for the one in front that nobody is looking at. Browser only; no timer of its own.
 */
export const IDLE_AFTER_MS = 10 * 60_000;

let last = Date.now();
const waiting = new Map<string, () => void>();

const touch = (): void => {
  const was = Date.now() - last > IDLE_AFTER_MS;
  last = Date.now();
  if (was) {
    const run = [...waiting.values()];
    waiting.clear();
    for (const f of run) f();
  }
};

// listening from the moment this file loads, so a person who has been using the page all along is never taken for an idle one
if (typeof window !== "undefined") for (const name of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(name, touch, { passive: true, capture: true });

export const userIdle = (now: number = Date.now()): boolean => now - last > IDLE_AFTER_MS;

/** Calls `fn` once, the next time the person touches the page after a long quiet; one waiting call per `key`. */
export function whenUserBack(key: string, fn: () => void): void {
  waiting.set(key, fn);
}

/** Tests only. */
export function resetUserIdleForTests(): void {
  last = Date.now();
  waiting.clear();
}
