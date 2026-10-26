import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AgentMark } from "@/components/v2/app/mark/AgentMark";
import { OrbMark } from "@/components/v2/app/mark/OrbMark";
import { PackProp } from "@/components/v2/auth/PackCard";
import { JsonLd, faqLd } from "@/components/v2/site/JsonLd";
import { PaverCalculator } from "@/components/v2/site/LazyIslands";
import type { CalcWords } from "@/components/v2/site/PaverCalculator";
import { CtaBand, FaqList, FeatureGrid, OWLS, Section } from "@/components/v2/site/sections";
import { hasWaitlist, WaitlistSection, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { btnPrimary, card, chip, container, eyebrow, lead, linkQuiet } from "@/components/v2/site/ui";
import { fillPlain } from "@/i18n/fill";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import type { LeadResult } from "@/lib/site/lead";
import { startEntry } from "@/lib/site/entry";
import { websiteOnly } from "@/lib/site/mode";
import { owlName, say, textIn } from "@/lib/site/packs";
import { sitePath } from "@/lib/site/paths";
import type { SitePack } from "@/lib/site/types";

type Actions = { quoteChat: (input: unknown) => Promise<LeadResult>; chatAvailable: boolean; waitlist?: WaitlistAction };

/**
 * The page of one business type (job CM, blueprint section 7), built ENTIRELY from its landing.json (and the pack's names and owl labels): the problem, a day with the owls, what it does, then the blocks the file asks for
 * (the calculator, the fee reminder preview, the children's data promise), the questions and the call to action. Nothing here names a business type: a new landing.json is a new page.
 */
export function PackPage({ pack, t, lang, actions }: { pack: SitePack; t: SiteT; lang: Lang; actions: Actions }) {
  const faq = pack.faq.map((f) => ({ q: say(f.q, lang), a: say(f.a, lang) }));
  const start = startEntry(t, lang, t("hero.cta"), { hasForm: hasWaitlist(actions.waitlist) });
  return (
    <>
      <section aria-labelledby="h1" className={`${container} grid items-center gap-8 pb-10 pt-6 sm:pt-10 lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:pb-16`}>
        <div>
          <p className={eyebrow} data-accent={pack.accent}>
            <span className={chip}>{textIn(pack.names, lang)}</span> <span className="ml-1">{say(pack.hero.eyebrow, lang)}</span>
          </p>
          <h1 id="h1" className="mt-3 max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
            {say(pack.hero.h1, lang)}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{say(pack.hero.sub, lang)}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href={start.href} className={`${btnPrimary} max-sm:min-h-12`}>
              {start.label}
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href={sitePath(lang, { kind: "page", page: "pricing" })} className={linkQuiet}>
              {t("nav.pricing")}
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted">{websiteOnly() ? t("demo.note") : t("hero.note")}</p>
          {!pack.validated ? <p className="mt-2 text-sm font-medium text-pack-text" data-accent={pack.accent}>{t("packs.notValidated")}</p> : null}
        </div>
        <div className="relative flex justify-center lg:justify-end">
          <span className="relative">
            <OrbMark px={224} mood="idle" className="size-44 sm:size-56" />
            <span data-accent={pack.accent} aria-hidden="true" className="absolute -bottom-1 -right-3 grid size-12 place-items-center rounded-full border-2 border-bg bg-pack-bg text-pack-text">
              <PackProp owlProp={pack.owlProp} className="size-6" />
            </span>
          </span>
        </div>
      </section>

      <Section id="problem" title={say(pack.problem.title, lang)} tone="soft">
        <ul className="grid gap-4 md:grid-cols-3">
          {pack.problem.points.map((p, i) => (
            <li key={i} className={card}>
              <p className="text-base">{say(p, lang)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="day" title={say(pack.day.title, lang)}>
        <ol className="flex flex-col gap-3" data-part="day">
          {pack.day.steps.map((s, i) => (
            <li key={i} className={`${card} flex items-start gap-4`}>
              <AgentMark agent={OWLS.includes(s.owl) ? s.owl : undefined} px={56} className="size-14" />
              <div>
                <p className="text-sm font-semibold text-muted">
                  <span className="tabular-nums">{s.time}</span> · {owlName(pack, s.owl, lang) ?? ""}
                </p>
                <p className="mt-0.5 text-base">{say(s.text, lang)}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="features" title={say(pack.features.title, lang)} tone="soft">
        <FeatureGrid items={pack.features.items} lang={lang} />
      </Section>

      {pack.calculator ? (
        <Section id="calculator" title={say(pack.calculator.title, lang)} sub={say(pack.calculator.intro, lang)}>
          <PaverCalculator
            lang={lang}
            config={{ products: pack.calculator.products, default_wastage_bps: pack.calculator.default_wastage_bps, truck_capacity_pieces: pack.calculator.truck_capacity_pieces }}
            names={Object.fromEntries(pack.calculator.products.map((p) => [p.id, textIn(p.name, lang)]))}
            words={calcWords(t)}
            action={actions.quoteChat}
            privacyHref="/privacy"
            chatAvailable={actions.chatAvailable}
          />
          <p className="mt-3 max-w-3xl text-sm text-muted">{say(pack.calculator.note, lang)}</p>
        </Section>
      ) : null}

      {pack.fee_preview ? (
        <Section id="preview" title={say(pack.fee_preview.title, lang)} tone="soft">
          <figure aria-label={t("preview.title")} className="max-w-xl rounded-2xl border border-line bg-surface p-4 shadow-[var(--v2-shadow)] sm:p-5" data-part="fee-preview">
            <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
              <span>{t("preview.title")}</span>
              <span className={chip}>{say(pack.fee_preview.label, lang)}</span>
            </figcaption>
            <div className="mt-3 flex flex-col gap-2">
              {pack.fee_preview.messages.map((m, i) => (
                <p key={i} className={`max-w-[92%] rounded-2xl px-4 py-3 text-base leading-snug ${m.from === "parent" ? "self-end bg-brand-bg" : "self-start bg-surface-2"}`}>
                  <span className="mb-0.5 block text-sm font-medium text-muted">{m.from === "parent" ? t("preview.parent") : t("preview.school")}</span>
                  {say(m.text, lang)}
                </p>
              ))}
            </div>
          </figure>
          <p className="mt-3 max-w-xl text-sm text-muted">{say(pack.fee_preview.note, lang)}</p>
        </Section>
      ) : null}

      {pack.children_promise ? (
        <Section id="children" title={say(pack.children_promise.title, lang)} narrow>
          <ul className="flex flex-col gap-3" data-part="children-promise">
            {pack.children_promise.points.map((p, i) => (
              <li key={i} className={card}>
                <p className="text-base">{say(p, lang)}</p>
              </li>
            ))}
          </ul>
          <p className={`${lead} !max-w-none text-base`}>{say(pack.children_promise.note, lang)}</p>
          {websiteOnly() ? null : (
            <p className="mt-2">
              <Link href={sitePath(lang, { kind: "page", page: "security" })} className={linkQuiet}>
                {t("trust.more")}
              </Link>
            </p>
          )}
        </Section>
      ) : null}

      <Section id="faq" title={t("faq.title")} narrow>
        <FaqList items={faq} />
      </Section>
      <WaitlistSection t={t} lang={lang} action={actions.waitlist} />
      <CtaBand t={t} lang={lang} hasForm={hasWaitlist(actions.waitlist)} />
      <JsonLd data={faqLd(faq.map((f) => ({ q: fillPlain(f.q), a: fillPlain(f.a) })))} />
    </>
  );
}

function calcWords(t: SiteT): CalcWords {
  return {
    area: t("calc.area"), unit: t("calc.unit"), unitSqFt: t("calc.unit.sq_ft"), unitSqM: t("calc.unit.sq_m"), product: t("calc.product"), wastage: t("calc.wastage"), price: t("calc.price", { unit: "{unit}" }), priceHelp: t("calc.price.help"),
    result: t("calc.result"), pieces: t("calc.pieces"), pallets: t("calc.pallets"), trips: t("calc.trips"), withWastage: t("calc.withWastage"), material: t("calc.material"), delivered: t("calc.delivered"), bad: t("calc.bad"), cta: t("calc.cta"),
    ctaHelp: t("calc.cta.help"), leadName: t("calc.lead.name"), leadCity: t("calc.lead.city"), leadConsent: t("calc.lead.consent"), privacy: t("contact.privacy"), errConsent: t("contact.err.consent"), errName: t("contact.err.name"), errRate: t("contact.err.rate"),
    errGeneric: t("contact.err.generic"), unavailable: t("contact.unavailable"),
  };
}
