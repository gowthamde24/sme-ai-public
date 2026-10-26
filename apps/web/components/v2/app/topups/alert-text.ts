import { alertLevel, dayLabel } from "@/lib/topups/logic";
import type { Kind, Meter, UsageView } from "@/lib/topups/types";

import type { Say } from "../words";

/** The short word each kind goes by in the words (`tu.alert.80.minutes`...). */
export const SHORT: Record<Kind, "minutes" | "messages"> = { call_minutes: "minutes", whatsapp_messages: "messages" };

export type TopupAlert = { level: 80 | 100; kind: Kind; meter: Meter };

/** The meter that needs the owner first: a used-up one before a nearly used-up one, minutes before messages. null while both are below 80 percent. */
export function topupAlert(usage: UsageView): TopupAlert | null {
  const a = alertLevel(usage.minutes);
  const b = alertLevel(usage.messages);
  if (a === 0 && b === 0) return null;
  return b > a ? { level: b as 80 | 100, kind: "whatsapp_messages", meter: usage.messages } : { level: a as 80 | 100, kind: "call_minutes", meter: usage.minutes };
}

/** The sentence for an alert: at 80 percent how far it is and when it runs out at this pace; at 100 percent what waits. */
export function alertSentence(t: Say, alert: TopupAlert): string {
  const short = SHORT[alert.kind];
  if (alert.level === 100) return t(`tu.alert.100.${short}`, { n: alert.meter.queued });
  const run = alert.meter.projectedRunOutOn ? ` ${t("tu.alert.runout", { date: dayLabel(alert.meter.projectedRunOutOn) })}` : "";
  return `${t(`tu.alert.80.${short}`, { n: alert.meter.percent ?? 80 })}${run}`;
}
