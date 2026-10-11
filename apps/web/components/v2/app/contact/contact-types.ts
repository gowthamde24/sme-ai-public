/**
 * What the lead page's "Contact this lead" asks of the server and what it gets back (job AV). A result carries OUR sentences (never text from the API): `text` says where the message or the request stands,
 * `recordText` says what happened to "Keep a record of this". `state` is a closed set; only `sent` means the message really went out.
 */
export type ContactResult =
  | { ok: true; channel: "whatsapp"; state: "sent" | "queued" | "needs_approval" | "blocked"; text: string; record: "kept" | "off" | "later" | "failed"; recordText: string }
  | { ok: true; channel: "call"; state: "requested"; text: string; record: "off"; recordText: string }
  | { ok: false; error: string };

export type ContactActions = {
  whatsapp: (input: { messageId: string; touchId: string; text: string; language: string; category: string; keepRecord: boolean }) => Promise<ContactResult>;
  call: (input: { requestId: string; reason: string; script: string; language: string }) => Promise<ContactResult>;
};
