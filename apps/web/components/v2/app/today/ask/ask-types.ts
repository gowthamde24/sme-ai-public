/**
 * What the "Ask your team" box needs from the Main agent, as the box reads it: a question goes out, and an answer comes back as a stream of these events. This is the box's side of the
 * contract (Job AG, Claude 1) written as narrowly as the screen needs; `transport.ts` is the ONE place that turns the real endpoint into this shape, and until the endpoint exists it is
 * empty and the box says "Not available yet". Everything an event carries is untrusted text (it can quote a customer's e-mail): the box draws it as plain text, never as markup, and follows
 * a link only when it points inside this workspace.
 */
export type AskEvent =
  /** The next piece of the answer, in the order it was written. */
  | { type: "text"; delta: string }
  /** Where a fact in the answer came from: a screen of this workspace (`href` is a path inside it). */
  | { type: "source"; label: string; href: string }
  /** A draft the Main agent prepared. It is only a draft: a person approves it on the screen `href` names. */
  | { type: "draft"; id: string; kind: string; title: string; summary: string; href: string }
  /** The answer could not be completed. Nothing was changed. */
  | { type: "error" }
  | { type: "done" };

export type AskRequest = { question: string; lang: string; signal: AbortSignal };
export type AskTransport = (request: AskRequest) => AsyncIterable<AskEvent>;

export type AskSource = { label: string; href: string };
export type AskDraft = { id: string; kind: string; title: string; summary: string; href: string };

/** `live`: the box can ask. The other two say why it cannot: the Main agent is not built (`not_available`) or its switch is off (`switched_off`). */
export type Availability = "live" | "not_available" | "switched_off";
