import Link from "next/link";

import { PackProp } from "@/components/v2/auth/PackCard";
import { JsonLd, faqLd } from "@/components/v2/site/JsonLd";
import { PaverCalculator } from "@/components/v2/site/LazyIslands";
import { PackLeadDesk } from "@/components/v2/site/PackLeadDesk";
import type { CalcWords } from "@/components/v2/site/PaverCalculator";
import { CloseBand } from "@/components/v2/site/HomeSections";
import { FeatureIcon } from "@/components/v2/site/icons";
import { DashRows, V3Faq, V3Section } from "@/components/v2/site/PackSections";
import { hasWaitlist, WaitlistSection, type WaitlistAction } from "@/components/v2/site/WaitlistSection";
import { btnPrimary, h1Home, h3Row, linkQuiet, pillHome, wrapHome } from "@/components/v2/site/ui";
import { AssistantOrb } from "@/components/v2/LazyAssistantOrb";
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
 * (the calculator, the children's data promise), the questions and the call to action. Nothing here names a business type: a new landing.json is a new page.
 */
export function PackPage({ pack, t, lang, actions }: { pack: SitePack; t: SiteT; lang: Lang; actions: Actions }) {
  const faq = pack.faq.map((f) => ({ q: say(f.q, lang), a: say(f.a, lang) }));
  const start = startEntry(t, lang, t("hero.cta"), { hasForm: hasWaitlist(actions.waitlist) });
  return (
    <>
      <section aria-labelledby="h1" className="bg-surface pb-[84px] pt-10 sm:pb-[120px]">
        <div className={`${wrapHome} grid items-center gap-10 lg:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]`}>
          <div>
            <p className={`${pillHome} inline-flex items-center gap-2`} data-accent={pack.accent}>
              <PackProp owlProp={pack.owlProp} className="size-4 text-pack-text" />
              {textIn(pack.names, lang)}
            </p>
            <h1 id="h1" className={`${h1Home} mt-5`}>
              {say(pack.hero.h1, lang)}
            </h1>
            <p className="mt-7 max-w-[31em] text-lg leading-relaxed text-muted sm:text-xl">{say(pack.hero.sub, lang)}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href={start.href} className={`${btnPrimary} rounded-full font-bold max-sm:w-full`}>
                {start.label}
              </Link>
              <Link href={sitePath(lang, { kind: "page", page: "pricing" })} className="inline-flex min-h-14 items-center justify-center rounded-full border-[1.5px] border-ink px-6 text-base font-semibold text-ink hover:bg-surface-2 max-sm:w-full">
                {t("nav.pricing")}
              </Link>
            </div>
            <p className="mt-5 text-[14.5px] text-muted">{websiteOnly() ? t("demo.note") : t("hero.note")}</p>
            {!pack.validated ? <p className="mt-2 text-sm font-medium text-pack-text" data-accent={pack.accent}>{t("packs.notValidated")}</p> : null}
          </div>
          <div className="relative grid place-items-center max-lg:pt-2">
            <span aria-hidden="true" data-part="hero-orb" className="relative block aspect-square w-[min(360px,78%)] rounded-full bg-[radial-gradient(circle_at_80%_70%,#4a1a0c,#24100b_55%,#120807)] shadow-[0_40px_90px_-20px_rgba(255,106,43,0.55)]">
              <AssistantOrb state="speaking" />
            </span>
          </div>
        </div>
      </section>

      <PackLeadDesk packId={pack.id} t={t} lang={lang} />

      <V3Section id="problem" title={say(pack.problem.title, lang)} tone="mist" split>
        <DashRows part="problem" items={pack.problem.points.map((p) => say(p, lang))} />
      </V3Section>

      <V3Section id="day" title={say(pack.day.title, lang)} split>
        <ol className="relative m-0 list-none p-0 before:absolute before:bottom-2 before:left-[70px] before:top-2 before:w-0.5 before:bg-line sm:before:left-[92px]" data-part="day">
          {pack.day.steps.map((s, i) => (
            <li key={i} className="relative grid grid-cols-[70px_minmax(0,1fr)] gap-x-[26px] pb-11 last:pb-0 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-x-9 after:absolute after:left-16 after:top-[9px] after:size-3.5 after:rounded-full after:border-[3px] after:border-brand-text after:bg-surface sm:after:left-[85px]">
              <time className="pr-4 text-right font-display text-lg font-bold leading-tight tabular-nums sm:pr-[22px] sm:text-[22px]">{s.time}</time>
              <div>
                {owlName(pack, s.owl, lang) ? <h3 className="text-2xl font-bold tracking-[-0.01em]">{owlName(pack, s.owl, lang)}</h3> : null}
                <p className="mt-1.5 text-muted">{say(s.text, lang)}</p>
              </div>
            </li>
          ))}
        </ol>
      </V3Section>

      <V3Section id="features" title={say(pack.features.title, lang)} tone="mist">
        <ul className="m-0 grid list-none gap-0 border-t border-line p-0 md:grid-cols-2 lg:grid-cols-3" data-part="features">
          {pack.features.items.map((f, i) => (
            <li key={i} className="border-b border-line py-8 md:pr-8 lg:py-9">
              <span className="mb-4 grid size-10 place-items-center rounded-xl bg-brand-bg text-brand-text">
                <FeatureIcon id={f.icon} />
              </span>
              <h3 className={h3Row}>{say(f.title, lang)}</h3>
              <p className="mt-2.5 text-[15.5px] text-muted">{say(f.body, lang)}</p>
            </li>
          ))}
        </ul>
      </V3Section>

      {pack.calculator ? (
        <V3Section id="calculator" title={say(pack.calculator.title, lang)} sub={say(pack.calculator.intro, lang)}>
          <PaverCalculator
            lang={lang}
            config={{ products: pack.calculator.products, default_wastage_bps: pack.calculator.default_wastage_bps, truck_capacity_pieces: pack.calculator.truck_capacity_pieces }}
            names={Object.fromEntries(pack.calculator.products.map((p) => [p.id, textIn(p.name, lang)]))}
            words={calcWords(t)}
            action={actions.quoteChat}
            privacyHref="/privacy"
            chatAvailable={actions.chatAvailable}
          />
          <p className="mt-4 max-w-3xl text-[15.5px] text-muted">{say(pack.calculator.note, lang)}</p>
        </V3Section>
      ) : null}

      {pack.children_promise ? (
        <V3Section id="children" title={say(pack.children_promise.title, lang)} tone="mist" split>
          <DashRows part="children-promise" items={pack.children_promise.points.map((p) => say(p, lang))} />
          <p className="mt-6 max-w-[44em] text-muted">{say(pack.children_promise.note, lang)}</p>
          {websiteOnly() ? null : (
            <p className="mt-3">
              <Link href={sitePath(lang, { kind: "page", page: "security" })} className={linkQuiet}>
                {t("trust.more")}
              </Link>
            </p>
          )}
        </V3Section>
      ) : null}

      <V3Section id="faq" title={t("faq.title")} tone={pack.children_promise ? undefined : "mist"}>
        <V3Faq items={faq} />
      </V3Section>
      <WaitlistSection t={t} lang={lang} action={actions.waitlist} />
      <CloseBand t={t} lang={lang} />
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
