import type { Failed, Reply } from "./kit";

/**
 * Calls to our own routes from the browser (job CC): same site, the session cookie goes with them, the API token never does. Every answer is a Reply: the route's JSON, or a plain failure when the route could
 * not be reached or answered something else. The caller turns a Failed into a sentence (kit.ts: sentenceOf).
 */
const unreachable: Failed = { ok: false, kind: "unavailable", error: "" };

async function readReply<T>(res: Response): Promise<Reply<T>> {
  try {
    const json: unknown = await res.json();
    if (typeof json === "object" && json !== null && "ok" in json && typeof (json as { ok: unknown }).ok === "boolean") return json as Reply<T>;
  } catch {
    // not JSON: handled below
  }
  if (res.status === 403) return { ok: false, kind: "forbidden", error: "" };
  if (res.status === 429) return { ok: false, kind: "rate_limited", error: "" };
  if (res.status === 401) return { ok: false, kind: "other", error: "", code: "signed_out" };
  return res.status >= 500 ? unreachable : { ok: false, kind: "other", error: "" };
}

export async function postFile<T>(url: string, file: Blob, contentType?: string): Promise<Reply<T>> {
  try {
    return await readReply<T>(await fetch(url, { method: "POST", body: file, headers: { "Content-Type": contentType || file.type || "application/octet-stream" }, cache: "no-store", credentials: "same-origin" }));
  } catch {
    return unreachable;
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<Reply<T>> {
  try {
    return await readReply<T>(await fetch(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, cache: "no-store", credentials: "same-origin" }));
  } catch {
    return unreachable;
  }
}

/** A POST whose good answer is a file: the bytes and the few X- headers the route passes on. A refusal comes back as the route's JSON Failed. */
export async function postForFile(url: string, body: unknown): Promise<{ ok: true; blob: Blob; filename: string | null; headers: Record<string, string> } | Failed> {
  try {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, cache: "no-store", credentials: "same-origin" });
    if (!res.ok) {
      const r = await readReply<never>(res);
      return r.ok ? unreachable : r;
    }
    const disposition = res.headers.get("Content-Disposition");
    const m = disposition ? /filename="?([A-Za-z0-9._-]{1,120})"?\s*(?:;|$)/.exec(disposition) : null;
    const headers: Record<string, string> = {};
    for (const name of ["x-export-sales", "x-export-payments"]) {
      const v = res.headers.get(name);
      if (v !== null && /^\d{1,9}$/.test(v)) headers[name] = v;
    }
    return { ok: true, blob: await res.blob(), filename: m && /[A-Za-z0-9]/.test(m[1]) ? m[1] : null, headers };
  } catch {
    return unreachable;
  }
}
