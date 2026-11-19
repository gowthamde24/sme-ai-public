/**
 * Server-Timing, the pure part (C2, 19 Nov 2026): the switch, the clock, the names and the header text. No React in here, so `proxy.ts` can import it.
 * The whole feature is OFF unless SERVER_TIMING=1 (staging only, docs/runbooks/hosting-env-and-secrets.md). It records NUMBERS and SPAN NAMES only: never a token, an id, an address or a name.
 */
export const serverTimingOn = (): boolean => process.env.SERVER_TIMING === "1";

/** Only the workspace's own pages (`/app/tenants/...`) are measured. */
export const inTimingScope = (pathname: string): boolean => pathname.startsWith("/app/tenants/");

/** A span name is fixed words of ours: lower case, digits and underscores, so it is also a valid Server-Timing token. */
export const SPAN_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** Milliseconds since 1970 with a fraction (the one clock of the proxy and of the render, which run on the same machine). */
export function epochMs(): number {
  return typeof performance !== "undefined" && typeof performance.timeOrigin === "number" ? performance.timeOrigin + performance.now() : Date.now();
}

/** One decimal place: a timing needs no more, and the header stays short. */
export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** `name;dur=12.3, other;dur=0.4` for the Server-Timing header. A name that is not one of ours, or a value that is not a finite number, is left out. */
export function headerValue(entries: ReadonlyArray<readonly [string, number]>): string {
  return entries
    .filter(([name, ms]) => SPAN_NAME.test(name) && Number.isFinite(ms))
    .map(([name, ms]) => `${name};dur=${round1(Math.max(0, ms))}`)
    .join(", ");
}
