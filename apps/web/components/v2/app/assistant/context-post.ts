import type { ContextError, ContextState, Done, TestAnswer, Understood, VersionItem } from "@/lib/context/types";

/** The "About my business" screen's calls: this app's OWN route `<workspace>/context` (a path it is given), never the API, no token. Anything that is not a clear answer is the closed word "down". */
export type PostBody =
  | { op: "get" }
  | { op: "put"; notes: string; version: number }
  | { op: "versions" }
  | { op: "restore"; version: number }
  | { op: "understand"; kind: "paste" | "file" | "voice"; text?: string; filename?: string; contentBase64?: string; language?: string }
  | { op: "save"; previewId: string; notes: string; mode: "append" | "replace"; version: number }
  | { op: "test"; question: string; language?: string };
export type Post = {
  (body: { op: "get" }): Promise<Done<ContextState>>;
  (body: { op: "put"; notes: string; version: number }): Promise<Done<ContextState>>;
  (body: { op: "versions" }): Promise<Done<VersionItem[]>>;
  (body: { op: "restore"; version: number }): Promise<Done<ContextState>>;
  (body: { op: "understand"; kind: "paste" | "file" | "voice"; text?: string; filename?: string; contentBase64?: string; language?: string }): Promise<Done<Understood>>;
  (body: { op: "save"; previewId: string; notes: string; mode: "append" | "replace"; version: number }): Promise<Done<ContextState>>;
  (body: { op: "test"; question: string; language?: string }): Promise<Done<TestAnswer>>;
};

export function makePost(endpoint: string, fetcher: typeof fetch = (...a) => fetch(...a)): Post {
  return (async (body: Record<string, unknown>) => {
    try {
      const res = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", credentials: "same-origin", redirect: "error" });
      if (!res.ok) return { ok: false, error: res.status === 404 ? "forbidden" : "down" };
      const json: unknown = await res.json();
      if (typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true && "data" in json) return json;
      const error = (json as { error?: unknown } | null)?.error;
      return { ok: false, error: (typeof error === "string" ? error : "down") as ContextError };
    } catch {
      return { ok: false, error: "down" };
    }
  }) as Post;
}
