import type { Entry, PronError } from "@/lib/pronunciation/types";

/**
 * The pronunciation screens' calls, from the BROWSER: this app's OWN routes `<workspace>/pronunciation` (save, remove) and `<workspace>/pronunciation-preview` (the sound), both paths the caller is given: never the API, no token. Anything that is not a clear answer is the closed word "down".
 * Used by Settings > AI assistant > Pronunciation and by "Mispronounced?" in the chat.
 */
export type Out = { ok: true; entry?: Entry } | { ok: false; error: PronError };

export async function postPronunciation(endpoint: string, body: Record<string, unknown>): Promise<Out | "signin"> {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
    if (r.status === 401) return "signin";
    return (await r.json()) as Out;
  } catch {
    return { ok: false, error: "down" };
  }
}

/** The sound of a respelling (an address the caller built from its own route), or null when it could not be made. */
export async function fetchSound(url: string): Promise<Blob | null> {
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error" });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}
