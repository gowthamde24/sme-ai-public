import { vi } from "vitest";

import { agentWords } from "@/app/app/tenants/[tenantId]/settings/agent-words";

/** Shared by the tests of the Vijaya settings: English words and a pinned clock (Wednesday 14 October 2026, 10:00 in India). Test code only. */
export const WORDS = agentWords("en");
export const NOW = Date.parse("2026-10-14T04:30:00Z");
export const ok = (message: string) => vi.fn(async () => ({ ok: true as const, message }));
