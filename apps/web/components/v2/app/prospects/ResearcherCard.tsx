"use client";

import { CalendarDays, Check, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { fitWord, type Prospect } from "@/lib/lead-finder/types";

import { makeT, type Words } from "../words";
import { ContactedNote, MarkForm, useMarkContacted, type MarkContactedActions } from "./MarkContacted";
import { facts } from "./facts";
import { telHref, visitHref } from "./ProspectContact";

const RING = 56;
const STROKE = 5;
const R = (RING - STROKE) / 2;
const C = 2 * Math.PI * R;

/** The fit as a ring with the number inside and the word "fit" under it (mock 05): green for a strong or good fit, amber for a maybe. The colour is never the only sign: the number and the chip word say it too. */
export function FitRing({ score, words }: { score: number; words: Words }) {
  const t = makeT(words);
  const stroke = fitWord(score) === "maybe" ? "var(--jb-wait-bg, #f5a30b)" : "var(--jb-done-bg, #15803d)";
  return (
    <span role="img" aria-label={t("jobs.trust.fit.aria", { n: score })} data-part="fit-ring" data-fit={fitWord(score)} className="relative grid size-[56px] shrink-0 place-items-center">
      <svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`} aria-hidden="true" className="-rotate-90">
        <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke="var(--color-line, #e5e7eb)" strokeWidth={STROKE} />
        <circle cx={RING / 2} cy={RING / 2} r={R} fill="none" stroke={stroke} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${(C * Math.min(100, Math.max(0, score))) / 100} ${C}`} />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[19px] font-bold tabular-nums">{score}</span>
        <span className="mt-0.5 text-[11px] font-semibold text-muted">{t("jobs.trust.fit")}</span>
      </span>
    </span>
  );
}

const secondary = "inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border border-edge bg-surface px-3 text-[15px] font-bold text-ink hover:bg-surface-2 disabled:opacity-60";

/**
 * One business the Researcher found, as in mock 05 (JOBS): the fit ring with the number and the word, the name and the chip (Strong fit, Good fit, Maybe), where it is, "Why it fits", "Talking points" (only when the API sent them) and the buttons: "Call from
 * your phone" as the ONE full-width primary, "Plan a visit" and "Mark as contacted" side by side under it. There is NO AI call and NO WhatsApp for a prospect anywhere (owner, 18 Nov): the call is a `tel:` link that opens the person's own phone. Marking says the
 * person spoke to the business themselves; it sends nothing.
 */
export function ResearcherCard({ prospect: p, words, base, mark, badges }: { prospect: Prospect; words: Words; base: string; /** Absent = "Mark as contacted" is not drawn (read-only, a business marked not interested). */ mark?: MarkContactedActions["mark"]; badges?: ReactNode }) {
  const t = makeT(words);
  const m = useMarkContacted(p, { mark: mark ?? (async () => ({ ok: false, kind: "unavailable", error: "" })) });
  const tel = telHref(p.phone);
  const factsLine = facts(p, t);
  const word = p.fitScore !== null ? fitWord(p.fitScore) : null;
  return (
    <div className="@container flex min-w-0 flex-col gap-3" data-part="researcher">
      <div className="flex items-start gap-3">
        {p.fitScore !== null ? <FitRing score={p.fitScore} words={words} /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="m-0 break-words font-display text-[17px] font-bold leading-snug">{p.name ?? t("lf.details.unavailable")}</h3>
            {word ? (
              <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-surface-2 px-3 py-1 text-sm font-bold text-ink" data-part="fit-chip">
                {t(`jobs.trust.fit.${word}`)}
              </span>
            ) : null}
          </div>
          {factsLine ? (
            <p className="m-0 mt-0.5 break-words text-sm text-muted" data-facts="">
              {factsLine}
            </p>
          ) : null}
          {badges ? <div className="mt-1 flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
      </div>

      <ContactedNote m={m} words={words} />

      {p.fitReason ? (
        <section aria-label={t("jobs.trust.why")} data-part="why-it-fits">
          <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-muted">{t("jobs.trust.why")}</h4>
          <p className="m-0 mt-1 break-words text-[15px] leading-snug">{p.fitReason}</p>
        </section>
      ) : null}

      {p.talkingPoints && p.talkingPoints.length > 0 ? (
        <section aria-label={t("jobs.trust.points")} data-part="talking-points">
          <h4 className="m-0 text-xs font-bold uppercase tracking-wider text-muted">{t("jobs.trust.points")}</h4>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-[15px] leading-snug">
            {p.talkingPoints.map((line, i) => (
              <li key={i} className="flex gap-2.5 break-words">
                <span aria-hidden="true" className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-ink" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {m.open ? (
        <MarkForm m={m} words={words} />
      ) : (
        <div className="flex flex-col gap-2" data-part="prospect-contact">
          {tel ? (
            <a href={tel} data-act="phone" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-brand-edge bg-brand px-4 text-base font-bold text-on-brand">
              <Phone aria-hidden="true" className="size-[18px]" />
              {t("lf.v6.call_phone")}
            </a>
          ) : (
            <p className="m-0 text-sm text-muted" data-part="prospect-no-phone">
              {t("lf.v6.no_phone")}
            </p>
          )}
          <div className={`grid grid-cols-1 gap-2 ${mark && !m.contacted ? "@[26rem]:grid-cols-2" : ""}`} data-part="secondary-actions">
            <Link href={visitHref(base, p.leadId)} data-act="visit" className={secondary}>
              <CalendarDays aria-hidden="true" className="size-[18px]" />
              {t("lf.v6.plan_visit")}
            </Link>
            {mark && !m.contacted ? (
              <button type="button" className={`${secondary} write-ctl`} onClick={() => m.setOpen(true)} data-act="mark-contacted">
                <Check aria-hidden="true" className="size-[18px]" />
                {t("lf.v6.mark.button")}
              </button>
            ) : null}
          </div>
          {mark && m.contacted ? (
            <button type="button" className="write-ctl inline-flex min-h-11 items-center justify-center gap-2 self-center px-3 text-[15px] font-bold text-brand-text" onClick={() => m.setOpen(true)} data-act="mark-contacted">
              <Pencil aria-hidden="true" className="size-4" />
              {t("lf.v6.mark.edit")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ResearcherCard;
