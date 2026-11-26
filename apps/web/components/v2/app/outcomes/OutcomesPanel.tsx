import { MessageCircle, PhoneCall } from "lucide-react";

import { CATEGORIES_OF, type Outcome, type OutcomeResult } from "@/lib/outcomes/types";

import { indiaDayText } from "../visits/dates";
import { Card } from "../Card";
import { pillAmber, pillGreen, pillNeutral, mutedText } from "../ui";
import { makeT, type Words } from "../words";
import { CorrectOutcomeForm } from "./CorrectOutcomeForm";
import type { CorrectOutcome } from "./types";

const rowItem = "border-t border-line pt-3 first:border-t-0 first:pt-0"; // an item of a Card: a row between hairlines, not a box inside the box

const PILL: Record<OutcomeResult, string> = { positive: pillGreen, negative: pillAmber, unclear: pillNeutral };
const time = (iso: string, lang: string): string => `${indiaDayText(iso, lang as "en")}, ${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso))}`;

/**
 * What happened after every call and every WhatsApp follow-up of one customer (job DM), newest first: the channel, when, the result (positive, negative or unclear), one line of reason and what kind of result it was. The AI
 * recorded it; the owner (or an Admin) can correct it, and a corrected one says so. `outcomes` null = it could not be read (the part says "Not available yet", never a guess). The reason is drawn as plain text. A server component
 * apart from the correction form.
 */
export function OutcomesPanel({ words, lang, outcomes, correct }: { words: Words; lang: string; outcomes: readonly Outcome[] | null; /** Null: the person may only read. */ correct: CorrectOutcome | null }) {
  const t = makeT(words);
  return (
    <Card data-part="outcomes" aria-labelledby="outcomes-heading" className="mt-6" headingId="outcomes-heading" title={t("outcome.title")}>
      <p className={mutedText}>{t("outcome.sub")}</p>
      {outcomes === null ? (
        <p className="mt-3 text-muted">{t("frame.notyet")}</p>
      ) : outcomes.length === 0 ? (
        <p className="mt-3 text-muted">{t("outcome.empty")}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {outcomes.map((o) => {
            const Icon = o.channel === "call" ? PhoneCall : MessageCircle;
            return (
              <li key={o.id} data-outcome={o.result} className={rowItem}>
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="size-5 shrink-0 text-muted" aria-hidden="true" />
                  <span className="text-sm font-semibold text-muted">{t(`outcome.channel.${o.channel}`)}</span>
                  <span className="text-sm text-muted">· {time(o.at, lang)}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-2">
                    <span className={PILL[o.result]}>{t(`outcome.result.${o.result}`)}</span>
                    <span className="text-sm font-semibold">{t(`outcome.cat.${o.category ?? "none"}`)}</span>
                  </span>
                </div>
                {o.reason ? <p className="mt-2 text-base [overflow-wrap:anywhere]">{o.reason}</p> : null}
                {o.corrected ? <p className="mt-1 text-sm font-medium text-muted">{t("outcome.corrected")}</p> : null}
                {correct ? <CorrectOutcomeForm words={words} outcome={o} options={CATEGORIES_OF} correct={correct} /> : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
