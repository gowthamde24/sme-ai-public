import type { OutcomeResult } from "@/lib/outcomes/types";

export type CorrectOutcome = (id: string, result: OutcomeResult, category: string) => Promise<{ ok: true } | { ok: false; error: string }>;
