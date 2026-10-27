import type { WaitlistWords } from "@/components/v2/site/WaitlistForm";
import { turnstileSiteKey } from "@/lib/security/turnstile";
import { WaitlistForm as LazyWaitlistForm } from "@/components/v2/site/LazyIslands";
import { Section } from "@/components/v2/site/sections";
import type { Lang } from "@/i18n/lang";
import type { SiteT } from "@/i18n/site";
import { SITE_PACKS, textIn } from "@/lib/site/packs";
import { waitlistMode } from "@/lib/waitlist/mode";
import { WAITLIST_LANGS, WAITLIST_LANG_NAMES, type WaitlistResult } from "@/lib/waitlist/types";

export type WaitlistAction = (input: unknown) => Promise<WaitlistResult>;

/** Is the form on this page? Only when the waitlist is on (lib/waitlist/mode.ts) and the page was given the action. */
export const hasWaitlist = (action: WaitlistAction | undefined): action is WaitlistAction => action !== undefined && waitlistMode() !== "off";

export function waitlistWords(t: SiteT): WaitlistWords {
  return {
    name: t("contact.name"), type: t("contact.type"), city: t("demo.city"), contact: t("demo.contact"), language: t("demo.lang"), marketing: t("demo.marketing"), notice: t("demo.notice"), privacy: t("contact.privacy"), submit: t("demo.submit"),
    thanksTitle: t("demo.thanks.t"), thanksBody: t("demo.thanks.d"), errName: t("contact.err.name"), errCity: t("contact.err.name"), errContact: t("demo.err.contact"), errRate: t("contact.err.rate"), errDown: t("demo.err.down"), errGeneric: t("contact.err.generic"), errCheck: t("contact.err.check"),
  };
}

/** The "Book a demo" section (id `demo`): the title, one line, and the form. Drawn on the server, live when its chunk arrives. Nothing when the waitlist is off. */
export function WaitlistSection({ t, lang, action, tone }: { t: SiteT; lang: Lang; action: WaitlistAction | undefined; tone?: "soft" }) {
  if (!hasWaitlist(action)) return null;
  return (
    <Section id="demo" title={t("demo.title")} sub={t("demo.sub")} tone={tone}>
      <LazyWaitlistForm lang={lang} types={SITE_PACKS.map((p) => ({ slug: p.slug, name: textIn(p.names, lang) })).concat([{ slug: "other", name: t("contact.type.other") }])} langs={WAITLIST_LANGS.map((code) => ({ code, name: WAITLIST_LANG_NAMES[code] }))} words={waitlistWords(t)} turnstile={turnstileSiteKey()} action={action} privacyHref="/privacy" />
    </Section>
  );
}

