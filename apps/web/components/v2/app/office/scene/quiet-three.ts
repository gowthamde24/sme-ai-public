/**
 * @react-three/fiber (9.8.1, the latest release) builds a `THREE.Clock` inside its own store for every Canvas. three r183 and newer say so in the console ("Clock: This module has been deprecated. Please use
 * THREE.Timer instead.") although nothing of ours creates a Clock: the Office reads only `state.clock.elapsedTime`, the owl on the landing page and in the Ask box runs on its own time and never touches one.
 * We cannot replace what the library builds, so this lets that ONE message through no more (every other warning still shows). Remove it when @react-three/fiber moves to `THREE.Timer`.
 */
export const CLOCK_WARNING = "Clock: This module has been deprecated";

let installed = false;
export function quietThreeClockWarning(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (args.some((a) => typeof a === "string" && a.includes(CLOCK_WARNING))) return;
    warn(...args);
  };
}
