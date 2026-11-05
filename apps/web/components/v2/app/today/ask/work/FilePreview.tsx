"use client";

import { FileSpreadsheet } from "lucide-react";

import type { FilePreviewCard } from "@/lib/assistant-work/types";

import { PlanView } from "./PlanView";
import { cardBox, type WorkEnv } from "./work-env";

/** "38 found · 4 already exist · 2 no phone · 1 looks like a supplier": each count in its own words (a `.one` form where English needs it). */
export function factText(t: WorkEnv["t"], code: string, n: number): string {
  const one = `bv.work.pv.fact.${code}.one`;
  return n === 1 && t(one) !== one ? t(one, { n }) : t(`bv.work.pv.fact.${code}`, { n });
}

/**
 * What the assistant found in a file, BEFORE anything is written: the counts, a few sample rows (as plain text: the file is untrusted), where it will go, and the plan that would put it there.
 * A list of people never messages or calls anyone by itself: the card says so.
 */
export function FilePreview({ card, env }: { card: FilePreviewCard; env: WorkEnv }) {
  const { t } = env;
  const where = card.destination === "customer" ? (card.customerName ? t("bv.work.pv.dest.customer", { name: card.customerName }) : t("bv.work.pv.dest.customer.none")) : t(`bv.work.pv.dest.${card.destination}`);
  return (
    <article data-work="preview" data-destination={card.destination} aria-label={t("bv.work.pv.title", { name: card.fileName })} className={cardBox}>
      <h3 className="flex items-start gap-2 text-base font-semibold [overflow-wrap:anywhere]">
        <FileSpreadsheet className="mt-0.5 size-5 shrink-0 text-brand-text" aria-hidden="true" />
        <span>{t("bv.work.pv.title", { name: card.fileName })}</span>
      </h3>
      {card.facts.length > 0 ? (
        <p data-work="facts" className="mt-1 text-sm font-semibold">
          {card.facts.map((f) => factText(t, f.code, f.n)).join(" · ")}
        </p>
      ) : null}
      {card.readBy !== "file" ? (
        <p data-work="read-by" data-read-by={card.readBy} className="mt-1 text-sm font-semibold text-amber-text">
          {t("bv.work.pv.picture")}
        </p>
      ) : null}
      {card.rows.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-semibold text-muted">{t("bv.work.pv.sample")}</p>
          {/* the rows wrap inside the card (no sideways scroll on a phone): one row is one line of "column: value" pairs */}
          <ul data-work="rows" className="mt-1 flex flex-col gap-1">
            {card.rows.map((row, i) => (
              <li key={i} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm [overflow-wrap:anywhere]">
                {row.map((cell, j) => (cell === "" ? null : <span key={j} className="mr-2 inline-block">{card.columns[j] ? <span className="text-muted">{card.columns[j]}: </span> : null}{cell}</span>))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-sm">
        <span className="font-semibold">{t("bv.work.pv.goes")}</span> {where}
      </p>
      {card.destination === "leads" ? <p className="mt-1 text-xs text-muted">{t("bv.work.pv.nocontact")}</p> : null}
      {card.plan ? (
        <div className="mt-3 border-t border-line pt-3">
          <PlanView plan={card.plan} env={env} />
        </div>
      ) : null}
    </article>
  );
}
