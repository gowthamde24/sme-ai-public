import { apiBaseUrl, originFetch } from "@/lib/api/client";

/** What the status page knows about the service: the API's own `GET /health` answered ("up"), did not ("down"), or could not be asked ("unknown": no address set, or the request itself failed). */
export type Health = { api: "up" | "down" | "unknown"; checkedAt: string };

/** Asks the API's /health once, with a short time limit. SERVER ONLY. Never throws. */
export async function readHealth(now: () => Date = () => new Date(), ask: (url: string, init: RequestInit) => Promise<Response> = originFetch): Promise<Health> {
  const checkedAt = now().toISOString();
  let base: string;
  try {
    base = apiBaseUrl();
  } catch {
    return { api: "unknown", checkedAt };
  }
  try {
    const res = await ask(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { api: "down", checkedAt };
    const body = (await res.json()) as { status?: unknown };
    return { api: body.status === "ok" ? "up" : "down", checkedAt };
  } catch {
    return { api: "down", checkedAt };
  }
}

/** The page's top line from the rows: "ok" only when every row is up. */
export const overall = (h: Health): "ok" | "down" | "unknown" => (h.api === "up" ? "ok" : h.api === "down" ? "down" : "unknown");
