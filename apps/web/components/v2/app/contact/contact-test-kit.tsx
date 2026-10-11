import { vi } from "vitest";

import { contactWords } from "@/app/app/tenants/[tenantId]/leads/[leadId]/contact-words";

import type { ContactActions, ContactResult } from "./contact-types";

export const WORDS = contactWords("en");
export const SENT: ContactResult = { ok: true, channel: "whatsapp", state: "sent", text: "Sent to the customer.", record: "kept", recordText: "A record was added to this lead's history." };

export function fakeContactActions(over: Partial<Record<keyof ContactActions, ReturnType<typeof vi.fn>>> = {}) {
  return {
    whatsapp: over.whatsapp ?? vi.fn(async () => SENT),
    call: over.call ?? vi.fn(async () => ({ ok: true as const, channel: "call" as const, state: "requested" as const, text: "Requested. The owner decides on Today. Nobody is called until then.", record: "off" as const, recordText: "A call request is not a record: a call is recorded when it happens." })),
  } as unknown as ContactActions & Record<keyof ContactActions, ReturnType<typeof vi.fn>>;
}
