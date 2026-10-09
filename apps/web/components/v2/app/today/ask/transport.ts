import type { AskEvent, AskTransport } from "./ask-types";

const KINDS = ["text", "source", "draft", "error", "done"];

/** One line of the route's answer as an AskEvent, or null for anything that is not one: the stream is this app's own, but its text is still untrusted and nothing is guessed. */
export function parseLine(raw: string): AskEvent | null {
  let e: unknown;
  try {
    e = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof e !== "object" || e === null) return null;
  const r = e as Record<string, unknown>;
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  if (typeof r.type !== "string" || !KINDS.includes(r.type)) return null;
  switch (r.type) {
    case "text":
      return typeof r.delta === "string" ? { type: "text", delta: r.delta } : null;
    case "source":
      return typeof r.label === "string" && (r.href === null || typeof r.href === "string") ? { type: "source", label: r.label, href: r.href } : null;
    case "draft":
      return typeof r.id === "string" && typeof r.kind === "string" && typeof r.title === "string" && typeof r.summary === "string" && (r.href === null || typeof r.href === "string")
        ? { type: "draft", id: r.id, kind: r.kind, title: r.title, summary: r.summary, href: r.href, language: s(r.language), gloss: s(r.gloss), machine: r.machine === true }
        : null;
    case "error":
      return { type: "error", code: s(r.code) ?? undefined };
    default:
      return { type: "done" };
  }
}

/**
 * The Main agent's answer as an AskTransport: the question goes to this workspace's own route (`<base>/ask`), which holds the person's token and asks the Main agent; the answer comes back
 * as one JSON event per line. The chat is one for the life of the box (a conversation id made here, so a follow-up question continues it) and every question is a NEW message id, so a
 * question sent again after a failure is never taken for a replay. A reply that is not the event stream (a sign-in page, an error page) is a failed answer, not text to show.
 */
export function makeAskTransport(endpoint: string, fetcher: typeof fetch = (...a) => fetch(...a)): AskTransport {
  const conversationId = crypto.randomUUID();
  return async function* ask({ question, signal }) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question, messageId: crypto.randomUUID(), conversationId }),
        signal,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      });
    } catch {
      yield { type: "error" };
      return;
    }
    if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").startsWith("application/x-ndjson")) {
      yield { type: "error" };
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let ended = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let cut = buffer.indexOf("\n");
        while (cut !== -1) {
          const event = parseLine(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 1);
          if (event) {
            yield event;
            if (event.type === "done" || event.type === "error") ended = true;
          }
          cut = buffer.indexOf("\n");
        }
        if (done) break;
      }
    } catch {
      if (!signal.aborted) yield { type: "error" };
      return;
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    if (!ended && !signal.aborted) yield { type: "error" }; // the stream stopped before its last word
  };
}
