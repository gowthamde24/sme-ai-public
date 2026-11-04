"use client";

import { Info } from "lucide-react";

import type { CantDoCard, WorkCard } from "@/lib/assistant-work/types";

import { FilePreview } from "./FilePreview";
import { PlanView } from "./PlanView";
import { SecretBox } from "./SecretBox";
import { SetupSteps } from "./SetupSteps";
import { cardBox, type WorkEnv } from "./work-env";

/** "Can't do yet" (or "always a person, on its screen"), honestly, with the screen where it is done. */
function CantDo({ card, env }: { card: CantDoCard; env: WorkEnv }) {
  const { t } = env;
  return (
    <article data-work="cant-do" data-reason={card.reason} className="mt-2 rounded-xl border border-line bg-surface p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Info className="mt-0.5 size-4 shrink-0 text-info-text" aria-hidden="true" />
        <span>{t(`bv.work.cant.${card.reason}`)}</span>
      </p>
      <p className="mt-1 text-sm [overflow-wrap:anywhere]">{card.what}</p>
      {card.screen ? (
        <a href={card.screen.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand-text underline underline-offset-2">
          {t("bv.work.open", { label: card.screen.label })}
        </a>
      ) : null}
    </article>
  );
}

/** The work cards of one answer, in the order they came. */
export function WorkCards({ cards, env }: { cards: readonly WorkCard[]; env: WorkEnv }) {
  return (
    <div data-work="cards" className="flex flex-col gap-2">
      {cards.map((card) => {
        switch (card.kind) {
          case "file_preview":
            return <FilePreview key={card.id} card={card} env={env} />;
          case "plan":
            return (
              <article key={card.id} className={cardBox}>
                <PlanView plan={card.plan} env={env} />
              </article>
            );
          case "secret":
            return <SecretBox key={card.id} card={card} env={env} />;
          case "setup":
            return <SetupSteps key={card.id} card={card} env={env} />;
          case "cant_do":
            return <CantDo key={card.id} card={card} env={env} />;
        }
      })}
    </div>
  );
}
