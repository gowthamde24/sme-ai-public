import { appDict } from "@/i18n/app";
import type { Lang } from "@/i18n/lang";

/** The words of the Agent OWL settings' client parts, in the person's language (a client component must not import the dictionaries): every `agentset.*` string, the scheduler lines shared with the Outbox, and the shared refusals. */
export function agentWords(lang: Lang): Record<string, string> {
  const dict = appDict(lang) as Record<string, string>;
  const keep = (k: string) => k.startsWith("agentset.") || k.startsWith("outbox.sched.") || k.startsWith("today.err.") || ["today.act.working", "frame.notyet"].includes(k);
  return Object.fromEntries(Object.entries(dict).filter(([k]) => keep(k)));
}
