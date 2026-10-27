import { mutedText, pillAmber, pillBrand, pillNeutral, surface } from "../ui";
import { makeT, type Words } from "../words";

import type { Touch } from "@/lib/api/lead-desk";

/**
 * "How this lead arrived" (night 4, part A6): every time the same person came to the business, with the source and the words they wrote (contact details inside them are removed by the API): the first arrival, then each time they came
 * again from another file or portal. Flags say when the number is on the do-not-disturb list (WhatsApp only, no promotional calls) or was not a valid number. The calls, the WhatsApp messages and their outcomes are the panel next to it.
 * A plain server part.
 */
export function LeadTimeline({ words, touches, flags, lang, sourceNames }: { words: Words; touches: readonly Touch[]; flags: readonly ("dnd" | "invalid_number")[]; lang: string; sourceNames: Readonly<Record<string, string>> }) {
  const t = makeT(words);
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString(lang, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
  return (
    <section data-part="lead-timeline" aria-labelledby="lt-h" className={`${surface} flex flex-col gap-3`}>
      <h2 id="lt-h" className="font-display text-xl font-bold">
        {t("ld.tl.title")}
      </h2>
      {flags.length > 0 ? (
        <p className="flex flex-wrap gap-2">
          {flags.map((f) => (
            <span key={f} className={f === "dnd" ? pillAmber : pillNeutral}>
              {t(`ld.tl.flag.${f}` as "ld.tl.flag.dnd")}
            </span>
          ))}
        </p>
      ) : null}
      {touches.length === 0 ? <p className={`${mutedText} !mt-0`}>{t("ld.tl.none")}</p> : null}
      <ol className="flex flex-col gap-3">
        {touches.map((x, i) => (
          <li key={i} className="flex flex-col gap-1 border-l-2 border-line pl-3">
            <p className="flex flex-wrap items-center gap-2 text-base">
              <span className="font-semibold">{x.kind === "first" ? t("ld.tl.first") : t("ld.tl.repeat")}</span>
              <span className={pillBrand}>{sourceNames[x.source] ?? x.source}</span>
              <span className="text-sm text-muted">{when(x.at)}</span>
            </p>
            {x.message ? <p className="break-words text-base">{x.message}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
