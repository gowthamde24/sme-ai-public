import { MessageCircle } from "lucide-react";

import type { ContactWords } from "@/components/v2/site/ContactForm";
import { ContactForm } from "@/components/v2/site/LazyIslands";
import { Section } from "@/components/v2/site/sections";
import { container, lead } from "@/components/v2/site/ui";
import type { SiteT } from "@/i18n/site";
import type { Lang } from "@/i18n/lang";
import type { LeadResult } from "@/lib/site/lead";
import { SITE_PACKS, textIn } from "@/lib/site/packs";

/**
 * Contact (job CM): WhatsApp click-to-chat and a small form with consent. Both end in OUR WhatsApp number with a message filled in; nothing typed is stored on the site, and when our number is not set up the page says so
 * and shows no button. Our number is not in the page's HTML: the server hands back the chat address only after the visitor has ticked consent.
 */
export function ContactPage({ t, lang, chatAvailable, action }: { t: SiteT; lang: Lang; chatAvailable: boolean; action: (input: unknown) => Promise<LeadResult> }) {
  const words: ContactWords = { name: t("contact.name"), type: t("contact.type"), other: t("contact.type.other"), what: t("contact.what"), consent: t("contact.consent"), privacy: t("contact.privacy"), submit: t("contact.submit"), nosave: t("contact.nosave"), errConsent: t("contact.err.consent"), errName: t("contact.err.name"), errRate: t("contact.err.rate"), errGeneric: t("contact.err.generic"), unavailable: t("contact.unavailable") };
  return (
    <>
      <section aria-labelledby="h1" className={`${container} pb-6 pt-8 sm:pt-12`}>
        <h1 id="h1" className="max-w-3xl font-display text-3xl font-bold leading-hero tracking-tight sm:text-5xl">
          {t("contact.title")}
        </h1>
        <p className={lead}>{t("contact.sub")}</p>
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted">
          <MessageCircle className="size-4" aria-hidden="true" />
          {t("contact.hours")}
        </p>
      </section>
      <Section id="form" title={t("contact.form.title")}>
        <ContactForm lang={lang} types={SITE_PACKS.map((p) => ({ slug: p.slug, name: textIn(p.names, lang) }))} words={words} action={action} privacyHref="/privacy" chatAvailable={chatAvailable} />
      </Section>
    </>
  );
}
