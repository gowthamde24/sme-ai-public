import Link from "next/link";

import { EmailAddress } from "@/components/v2/site/EmailAddress";
import { emailWords } from "@/components/v2/site/email-words";
import { HelpSearch, type HelpItem } from "@/components/v2/site/public/HelpSearch";
import { Dot, PubBody, PubHead, Steps, subHead } from "@/components/v2/site/public/parts";
import { TalkForm, type TalkWords } from "@/components/v2/site/public/TalkForm";
import { btnPrimary, btnSecondary } from "@/components/v2/site/ui";
import type { PubKey, PubT } from "@/i18n/public";
import type { SiteLang } from "@/i18n/lang";
import type { SiteT } from "@/i18n/site";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { articleBySlug, articleKeys, FREE_START, HELP_ARTICLES, INCIDENTS, pubVars, TALK_TIMES, TALK_TYPES } from "@/lib/public/data";
import type { TalkAction } from "@/lib/public/demo";
import { overall, type Health } from "@/lib/public/health";
import { startEntry } from "@/lib/site/entry";
import { ADDRESSES } from "@/lib/site/business";
import { sitePath } from "@/lib/site/paths";
import { PUBLIC_PLANS, rupees, type PublicPlan } from "@/lib/site/plans";

type Props = { t: SiteT; p: PubT; lang: SiteLang };

const nf = new Intl.NumberFormat("en-IN");

function planLines(plan: PublicPlan, p: PubT): string[] {
  const v = pubVars();
  if (plan.minutes === null) return [p("pub.price.l.permin", v), p("pub.price.l.number"), p("pub.price.l.channels")];
  return [p("pub.price.l.mins", { n: nf.format(plan.minutes) }), p("pub.price.l.extra", v), p(plan.setup === "priority" ? "pub.price.l.prio" : "pub.price.l.number")];
}

/** Pricing (approved mock): Rs 100 free, the three plans (one chosen: Pro, with the ink border), "Pay for what you use" rows, the GST note, three questions. */
export function PricingPublic({ t, p, lang }: Props) {
  const v = pubVars();
  const start = startEntry(t, lang, p("pub.c.start"));
  const rows: { id: string; tbc?: boolean }[] = [{ id: "call" }, { id: "number" }, { id: "unanswered", tbc: true }, { id: "testing", tbc: true }, { id: "wa" }];
  return (
    <>
      <PubHead title={p("pub.price.title")} sub={p("pub.price.sub")} />
      <PubBody wide>
        <div className="my-6 max-w-[760px] border-b border-line border-t-ink py-5 [border-top-width:1px] [border-top-color:var(--v2-ink)]" data-part="free-start">
          <p className="text-xl font-bold">{p("pub.price.trial.t", v)}</p>
          <p className="mt-1 text-base text-muted">{p("pub.price.trial.d", { minutes: FREE_START.minutes })}</p>
          <p className="mt-4">
            <Link href={start.href} className={`${btnPrimary} max-sm:w-full`}>{start.label}</Link>
          </p>
        </div>
        <h2 className="sr-only">{p("pub.price.plans.h")}</h2>
        <ul className="grid gap-3 md:grid-cols-3" data-part="plans">
          {PUBLIC_PLANS.map((plan) => (
            <li key={plan.id} data-plan={plan.id} {...(plan.recommended ? { "data-chosen": "" } : {})} className={`flex flex-col gap-1.5 rounded-[14px] border bg-bg p-5 ${plan.recommended ? "border-ink ring-1 ring-ink" : "border-line"}`}>
              <h3 className="text-lg font-bold">{plan.name}</h3>
              <p className="font-display text-3xl font-extrabold tracking-tight">
                {rupees(plan.monthly)} <small className="text-base font-semibold text-muted">{p("pub.price.mo")}</small>
              </p>
              <ul className="mt-2">
                {planLines(plan, p).map((line) => (
                  <li key={line} className="border-t border-line py-2 text-base">{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="max-w-[760px]">
          <h2 className={subHead}>{p("pub.price.use.h")}</h2>
          <dl className="border-t border-ink" data-part="use-rows">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-3.5">
                <dt className="font-semibold">{p(`pub.price.use.${r.id}.t` as PubKey)}</dt>
                <dd className="text-right text-muted">
                  {p(`pub.price.use.${r.id}.v` as PubKey, v)}
                  {r.tbc ? <span data-part="draft-tag" className="ml-2 inline-block rounded-full border border-edge px-2 py-0.5 text-xs font-semibold">{p("pub.price.tbc")}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">{p("pub.price.gst", v)}</p>
          <h2 className={subHead}>{p("pub.price.faq.h")}</h2>
          <ul className="border-t border-ink">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="border-b border-line py-4">
                <p className="text-lg font-semibold">{p(`pub.price.faq.${n}.q` as PubKey)}</p>
                <p className="mt-1 text-base text-muted">{p(`pub.price.faq.${n}.a` as PubKey)}</p>
              </li>
            ))}
          </ul>
        </div>
      </PubBody>
    </>
  );
}

function StillStuck({ t, p, lang }: Props) {
  return (
    <section aria-labelledby="stuck" className="mt-10" data-part="still-stuck">
      <h2 id="stuck" className={subHead.replace("mt-9", "mt-0")}>{p("pub.help.still.h")}</h2>
      <p className="mt-1 text-base text-muted">{p("pub.help.still.d")}</p>
      <div className="mt-3"><EmailAddress address={ADDRESSES.hello} words={emailWords(t)} /></div>
      <p className="mt-3">
        <Link href={sitePath(lang, { kind: "page", page: "talk-to-us" })} className={btnSecondary}>{p("pub.c.talk")}</Link>
      </p>
    </section>
  );
}

const textOf = (p: PubT, a: (typeof HELP_ARTICLES)[number]): string => articleKeys(a).body.map((k) => p(k, pubVars())).join(" ");

/** The help center (approved mock): search, the ten articles as open rows, and the contact entry. */
export function HelpCenter({ t, p, lang }: Props) {
  const items: HelpItem[] = HELP_ARTICLES.map((a) => {
    const k = articleKeys(a);
    return { slug: a.slug, href: sitePath(lang, { kind: "article", slug: a.slug }), title: p(k.title), summary: p(k.summary), text: textOf(p, a), draft: a.draft ? p("pub.c.draft") : undefined };
  });
  return (
    <>
      <PubHead title={p("pub.help.title")} sub={p("pub.help.sub")} />
      <PubBody>
        <HelpSearch items={items} words={{ label: p("pub.help.search.label"), button: p("pub.help.search.btn"), none: p("pub.help.search.none") }} />
        <StillStuck t={t} p={p} lang={lang} />
      </PubBody>
    </>
  );
}

/** One help article: the title, one line, three plain steps, and the way to reach us. */
export function HelpArticlePage({ t, p, lang, slug }: Props & { slug: string }) {
  const a = articleBySlug(slug);
  if (!a) return null;
  const k = articleKeys(a);
  const v = pubVars();
  return (
    <>
      <PubHead title={p(k.title)} sub={p(k.summary)} draft={a.draft ? p("pub.c.draft") : undefined} />
      <PubBody>
        <Steps items={k.body.map((key) => ({ text: p(key, v) }))} />
        <p className="mt-6">
          <Link href={sitePath(lang, { kind: "page", page: "help" })} className="inline-flex min-h-11 items-center font-semibold text-brand-text hover:underline">← {p("pub.help.back")}</Link>
        </p>
        <StillStuck t={t} p={p} lang={lang} />
      </PubBody>
    </>
  );
}

const when = (iso: string): string => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Status (approved mock): one top line (dot and sentence), the rows we can really measure, the last 7 days (a static note area) and how it works. */
export function StatusPublic({ p, health }: { p: PubT; health?: Health }) {
  const state = health ? overall(health) : "unknown";
  const row = (label: string, tone: "ok" | "bad" | "idle", value: string) => (
    <li className="flex items-center gap-3 border-b border-line py-3.5">
      <Dot tone={tone}><span>{label}</span></Dot>
      <span className="ml-auto text-sm text-muted">{value}</span>
    </li>
  );
  return (
    <>
      <PubHead title={p("pub.status.title")} sub={p("pub.status.sub")} />
      <PubBody>
        <p role="status" data-part="status-top" data-state={state} className="mt-4 border-y border-line py-4 text-lg font-bold [border-top-color:var(--v2-ink)]">
          <Dot tone={state === "ok" ? "ok" : state === "down" ? "bad" : "idle"}>{p(state === "ok" ? "pub.status.ok" : state === "down" ? "pub.status.down" : "pub.status.unknown")}</Dot>
        </p>
        <ul data-part="status-rows">
          {row(p("pub.status.r.site"), "ok", p("pub.status.working"))}
          {row(p("pub.status.r.api"), health?.api === "up" ? "ok" : health?.api === "down" ? "bad" : "idle", p(health?.api === "up" ? "pub.status.working" : health?.api === "down" ? "pub.status.notworking" : "pub.status.unchecked"))}
        </ul>
        {health ? <p className="mt-2 text-sm text-muted">{p("pub.status.checked", { time: when(health.checkedAt) })}</p> : null}
        <h2 className={subHead}>{p("pub.status.past.h")}</h2>
        {INCIDENTS.length === 0 ? (
          <p className="text-base text-muted" data-part="incidents-none">{p("pub.status.past.none")}</p>
        ) : (
          <ul className="border-t border-ink" data-part="incidents">
            {INCIDENTS.map((i) => (
              <li key={i.started} className="border-b border-line py-4">
                <p className="font-semibold"><Dot tone={i.fixed ? "ok" : "bad"}>{i.title}</Dot></p>
                <p className="mt-1 text-sm text-muted">{when(i.started)} · {p(i.fixed ? "pub.status.fixed" : "pub.status.ongoing")}</p>
                <p className="mt-1 text-base text-muted">{i.text}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-sm text-muted">{p("pub.status.note")}</p>
      </PubBody>
    </>
  );
}

/** Acceptable use and Refunds (approved mock): a title with the Draft tag, numbered plain rules, one closing line and the contact address. */
export function RulesPage({ t, p, kind }: { t: SiteT; p: PubT; kind: "aup" | "refund" }) {
  const v = pubVars();
  const n = kind === "aup" ? 5 : 4;
  const items = Array.from({ length: n }, (_, i) => ({ head: p(`pub.${kind}.${i + 1}.h` as PubKey), text: p(`pub.${kind}.${i + 1}.t` as PubKey) }));
  return (
    <>
      <PubHead title={p(`pub.${kind}.title` as PubKey)} sub={p(`pub.${kind}.sub` as PubKey)} draft={p("pub.c.draft")} />
      <PubBody>
        <Steps items={items} />
        <p className="mt-6 text-base">{p(kind === "aup" ? "pub.aup.end" : "pub.refund.end", v)}</p>
        {kind === "aup" ? <p className="mt-2 text-base text-muted">{p("pub.aup.ask", v)}</p> : null}
        <div className="mt-3"><EmailAddress address={ADDRESSES.hello} words={emailWords(t)} /></div>
      </PubBody>
    </>
  );
}

/** Talk to us / Book a demo (approved mock). */
export function TalkPage({ p, lang, action }: { p: PubT; lang: SiteLang; action: TalkAction | undefined }) {
  const v = pubVars();
  const words: TalkWords = {
    name: p("pub.talk.name"), contact: p("pub.talk.contact"), type: p("pub.talk.type"), choose: p("pub.talk.type.choose"), time: p("pub.talk.time"), what: p("pub.talk.what"), consent: p("pub.talk.consent"), privacy: p("pub.talk.privacy"), submit: p("pub.talk.submit"), note: p("pub.talk.note"),
    okTitle: p("pub.talk.ok.t"), okBody: p("pub.talk.ok.d", v), errName: p("pub.talk.err.name"), errContact: p("pub.talk.err.contact"), errConsent: p("pub.talk.err.consent"), errRate: p("pub.talk.err.rate"), errCheck: p("pub.talk.err.check"), errGeneric: p("pub.talk.err.generic", v),
    types: TALK_TYPES.map((id) => ({ id, label: p(`pub.talk.t.${id}` as PubKey) })), times: TALK_TIMES.map((id) => ({ id, label: p(`pub.talk.time.${id}` as PubKey) })),
  };
  return (
    <>
      <PubHead title={p("pub.talk.title")} sub={p("pub.talk.sub")} />
      <PubBody>
        <div className="mt-6">
          {action ? <TalkForm lang={lang} words={words} action={action} privacyHref="/privacy" turnstile={turnstileSiteKey()} /> : <p className="text-base text-muted">{p("pub.talk.err.generic", v)}</p>}
        </div>
      </PubBody>
    </>
  );
}
