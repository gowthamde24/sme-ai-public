import type { Done } from "@/lib/sources/types";

/** The source cards' calls: this app's OWN route `<workspace>/lead-sources/cards` (a path it is given), never the API, no token. Anything that is not a clear answer is the closed word "down". */
export type CardsBody =
  | { op: "cards" }
  | { op: "meta_connect" }
  | { op: "meta_pages" }
  | { op: "meta_select"; pageId: string }
  | { op: "meta_disconnect" }
  | { op: "indiamart_key"; key: string }
  | { op: "indiamart_disconnect" }
  | { op: "email"; rotate?: boolean }
  | { op: "website" }
  | { op: "resume"; card: string };
export type CardsPost = (body: CardsBody) => Promise<Done<never>>;

export function makeCardsPost(endpoint: string, fetcher: typeof fetch = (...a) => fetch(...a)): CardsPost {
  return async (body) => {
    try {
      const res = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
      if (!res.ok) return { ok: false, error: res.status === 404 ? "forbidden" : "down" };
      const json = (await res.json()) as { ok?: unknown; data?: unknown; error?: unknown };
      if (json && json.ok === true && "data" in json) return json as Done<never>;
      return { ok: false, error: (typeof json?.error === "string" ? json.error : "down") as "down" };
    } catch {
      return { ok: false, error: "down" };
    }
  };
}
