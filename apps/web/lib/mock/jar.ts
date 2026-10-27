import { cookies } from "next/headers";

/**
 * The cookie the TEST screens (a feature flag set to `mock`) keep their fake data in (night 4): one small JSON value per name, checked by the reader's own `parse` on every read, never trusted. Nothing is sent anywhere. A value that
 * does not fit in a cookie (about 3.5 KB) is refused, never cut. SERVER ONLY.
 */
export const JAR_MAX = 3500;

export async function readJar<T>(name: string, parse: (value: unknown) => T | null, fallback: T): Promise<T> {
  try {
    const raw = (await cookies()).get(name)?.value;
    if (!raw) return fallback;
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** True when the value was kept. */
export async function writeJar(name: string, value: unknown, days = 7): Promise<boolean> {
  const text = JSON.stringify(value);
  if (text.length > JAR_MAX) return false;
  (await cookies()).set(name, text, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * days, path: "/" });
  return true;
}

export async function clearJar(name: string): Promise<void> {
  (await cookies()).set(name, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0, path: "/" });
}
