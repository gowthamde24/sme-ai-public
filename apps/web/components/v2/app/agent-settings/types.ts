import type { OutboxSettings } from "@/lib/api/outbox";
import type { SchedulerSettings } from "@/lib/api/scheduler";

/** What the Agent OWL settings ask of the server: our sentence for a success (`message`) or a refusal (`error`, with `mfa` when the second factor is missing). */
export type AgentResult = { ok: true; message: string } | { ok: false; error: string; mfa?: boolean };
export type AgentSettingsActions = {
  saveSending: (input: { auto_send_enabled: boolean; per_customer_daily_limit: number }) => Promise<AgentResult>;
  saveReminders: (input: Omit<SchedulerSettings, "is_default">) => Promise<AgentResult>;
};
export type { OutboxSettings, SchedulerSettings };
