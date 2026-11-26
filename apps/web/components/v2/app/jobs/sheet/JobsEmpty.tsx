"use client";

import { MessageSquare } from "lucide-react";
import { useRef } from "react";

import { popularOf, textIn, type SheetLoad } from "@/lib/jobs/templates";

import { makeT, type Words } from "../../words";
import { LazySheet } from "./LazySheet";
import { useSheet } from "./NewJobButton";
import { TemplateCard, type CardContext } from "./TemplateCard";
import type { SheetActions } from "./types";

/**
 * "No jobs yet" on the Jobs page (mock r3-07 C): the three popular live preview cards of the business type, one tap each (card, plan card, Start through the New job sheet), and "Or say what you need". Drawn only for the Owner and an Admin, with ideas to show.
 */
export function JobsEmpty({ words, base, actions, load }: { words: Words; base: string; actions: SheetActions; load: SheetLoad }) {
  const t = makeT(words);
  const sheet = useSheet();
  const say = useRef<HTMLButtonElement>(null);
  const lang = load.lang;
  const ctx: CardContext = {
    lang,
    business: load.business,
    assistant: load.assistant ?? t("jobs.tpl.sample.assistant"),
    item: (load.data.sampleItem ? textIn(load.data.sampleItem, lang) : null) ?? t("jobs.tpl.sample.item"),
    customer: t("jobs.tpl.sample.customer"),
    businessLang: load.businessLang ?? null,
  };
  const cards = popularOf(load.data.own).slice(0, 3);
  return (
    <section data-empty="jobs" data-part="jobs-empty" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 md:p-6">
      <div className="text-center">
        <h2 className="m-0 font-display text-[20px] font-bold text-ink">{t("jobs.new.empty.title")}</h2>
        <p className="m-0 mx-auto mt-1 max-w-xl text-[14px] leading-snug text-muted">{t("jobs.new.empty.sub")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((tpl, i) => (
          <TemplateCard key={tpl.id} template={tpl} ctx={ctx} words={words} index={i} compact onUse={(x) => sheet.show(null, { ask: textIn(x.ask, lang), template: x.id })} />
        ))}
      </div>
      <button ref={say} type="button" data-part="say-instead" onClick={() => sheet.show(say.current)} className="flex min-h-12 items-center gap-2.5 rounded-md border border-edge bg-surface px-5 text-[15px] text-muted">
        <MessageSquare aria-hidden="true" className="size-[18px]" />
        {t("jobs.new.empty.say")}
      </button>
      {sheet.open ? <LazySheet words={words} base={base} actions={actions} onClose={sheet.close} initial={load} initialAsk={sheet.ask} initialTemplate={sheet.template} /> : null}
    </section>
  );
}
