/** The sign-in for the voice socket's first message, from this app's own route (never from anything the page keeps). `{ ok: false }` for any failure. */
export async function askVoiceToken(tokenUrl: string): Promise<{ ok: true; token: string } | { ok: false }> {
  try {
    const res = await fetch(tokenUrl, { method: "POST", cache: "no-store", credentials: "same-origin" });
    const json: unknown = res.ok ? await res.json() : null;
    const token = typeof json === "object" && json !== null ? (json as { token?: unknown }).token : null;
    return typeof token === "string" && token.length > 0 ? { ok: true, token } : { ok: false };
  } catch {
    return { ok: false };
  }
}
