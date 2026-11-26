"use client";

import { Gift, MessageCircle, Mic, Phone, Search, Sparkles, Store, Zap } from "lucide-react";

import { pickSample } from "@/lib/jobs/sample-audio";
import { fillText, isWhyCode, textIn, type FillValues, type JobTemplate, type TemplateKind, type Texts, type WhyCode } from "@/lib/jobs/templates";

import { makeT, type Say, type Words } from "../../words";
import { CallSnippet, ExampleProspects, SamplePlayer, WaBubble } from "./Previews";

export const KIND_ICON: Record<TemplateKind, typeof Zap> = { speed_to_lead: Zap, answer_calls: Phone, followups: MessageCircle, store_visits: Store, offers: Gift, researcher: Search, custom: Sparkles };

/** What a card says about itself and how its previews are filled: the person's language, the shop's name, the assistant's name and an example item. */
export type CardContext = { lang: string; business: string; assistant: string; item: string; customer: string; /** the language the business talks to its customers in: the second choice of the sample voice */ businessLang?: string | null };
/** The sentence of why a prospect fits: a real one is a code with params (`jobs.why.<code>`, an unknown code reads as the generic line); an invented one is the data's own words with the placeholders filled. */
export function whyText(t: Say, words: Words, why: Texts | WhyCode, lang: string, v: FillValues): string {
  if (!isWhyCode(why)) return fillText(textIn(why, lang), v);
  const key = `jobs.why.${why.code}`;
  const sentence = words[key];
  // a sentence with a number or a word the API did not send would show "{km}": that is the generic line instead
  // the API's `rating` is told as `{score}` in the sentence (the word "rating" may not stand in our words: i18n/strings/forbidden.ts)
  const vars: Record<string, string | number> = { ...why.params, ...(why.params.rating !== undefined ? { score: why.params.rating } : {}) };
  const whole = typeof sentence === "string" && [...sentence.matchAll(/\{(\w+)\}/g)].every((m) => m[1] in vars);
  return t(whole ? key : "jobs.why.generic", vars);
}
export const fillValues = (c: CardContext): FillValues => ({ business: c.business, customer: c.customer, item: c.item, assistant: c.assistant });

/** The channel line under a card's title: what the job sends or does. */
export function channelKey(t: JobTemplate): string {
  if (t.kind === "researcher") return "jobs.tpl.chan.finds";
  if (t.whatsapp && t.call) return "jobs.tpl.chan.both";
  return t.call ? "jobs.tpl.chan.call" : "jobs.tpl.chan.whatsapp";
}

/**
 * A LIVE PREVIEW TEMPLATE CARD (mock r3-02): the real WhatsApp bubble with the shop's name filled in, or the two lines the assistant says on a call (and a round play button when a recorded sample exists), or the example shops of the Lead Finder (labelled
 * "Example"); one line of what it gives you, what it needs, "Use this" and a round microphone (put the sentence in the box and change it by talking). Two taps: card, plan card, Start. `compact` = the preview only (the empty Jobs page).
 */
export function TemplateCard({ template: tpl, ctx, words, onUse, onSay, busy = false, index = 0, compact = false }: { template: JobTemplate; ctx: CardContext; words: Words; onUse: (t: JobTemplate) => void; onSay?: (t: JobTemplate) => void; busy?: boolean; index?: number; compact?: boolean }) {
  const t = makeT(words);
  const Icon = KIND_ICON[tpl.kind];
  // {item}: the template's own sample item ("bridal silk sarees"), else the shop's (set by the sheet), else "your item"
  const v = fillValues({ ...ctx, item: tpl.sampleItem ? textIn(tpl.sampleItem, ctx.lang) : ctx.item });
  const title = textIn(tpl.title, ctx.lang);
  const chanKey = channelKey(tpl);
  const Chan = tpl.kind === "researcher" ? Search : tpl.call && !tpl.whatsapp ? Phone : MessageCircle;
  const sample = tpl.call ? pickSample(tpl.sampleAudio, ctx.lang, ctx.businessLang ?? null) : null;
  const needs = tpl.needs.map((n) => t(`jobs.tpl.needs.${n}`));
  return (
    <article data-part="template-card" data-template={tpl.id} data-kind={tpl.kind} aria-label={title} className="jb-enter flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 md:p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-bg text-brand-text">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 font-display text-[16px] font-bold leading-snug text-ink">{title}</h3>
          <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            <Chan aria-hidden="true" className="size-3.5" />
            {t(chanKey)}
            {tpl.season !== "none" ? <span className="ml-1 rounded bg-surface-2 px-2 py-px text-[11.5px] text-ink">{t(`jobs.tpl.season.${tpl.season}`)}</span> : null}
          </p>
        </div>
      </div>
      {tpl.whatsapp ? <WaBubble business={ctx.business} text={fillText(textIn(tpl.whatsapp, ctx.lang), v)} t={t} /> : null}
      {tpl.call ? <CallSnippet assistant={ctx.assistant} text={fillText(textIn(tpl.call, ctx.lang), v)} t={t} /> : null}
      {sample ? <SamplePlayer src={sample} t={t} /> : null}
      {tpl.examples.length > 0 ? (
        <>
          <ExampleProspects examples={tpl.examples} real={tpl.examplesReal} why={(e) => whyText(t, words, e.why, ctx.lang, v)} t={t} />
          <p className="m-0 text-[12.5px] leading-snug text-muted">{t(tpl.examplesReal ? "jobs.tpl.real.note" : "jobs.tpl.example.note")}</p>
        </>
      ) : null}
      <p className="m-0 text-[14.5px] font-medium leading-snug text-ink">{textIn(tpl.benefit, ctx.lang)}</p>
      {!compact && needs.length > 0 ? (
        <p data-part="needs" className="m-0 text-[12.5px] leading-snug text-muted">
          {t("jobs.tpl.needs", { list: needs.join(" · ") })}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <button type="button" data-action="use" onClick={() => onUse(tpl)} disabled={busy} className="jb-press inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-md border border-brand-edge bg-brand px-5 text-[15px] font-bold text-on-brand disabled:opacity-60">
          {t("jobs.tpl.use")}
        </button>
        {onSay ? (
          <button type="button" data-action="say" onClick={() => onSay(tpl)} disabled={busy} aria-label={t("jobs.tpl.say_it", { title })} className="jb-press grid size-11 shrink-0 place-items-center rounded-md border border-edge bg-surface text-brand-text disabled:opacity-60">
            <Mic aria-hidden="true" className="size-5" />
          </button>
        ) : null}
      </div>
    </article>
  );
}
