import "@/design/v9.css";

import { V9Calc, V9Cta, V9Faq, V9Finder, V9Ftr, V9Greet, V9Guard, V9Hdr, V9Hero, V9How, V9Jobs, V9Pricing, V9Try, V9Voices, V9Wit } from "./generated";
import { Reveal } from "./clients";
import type { SiteLang } from "@/i18n/lang";
import type { SiteT } from "@/i18n/site";

/**
 * The home page of the public site (landing v9, approved by the owner on 23 Nov 2026; the picture is mocks/landing-v9/index.html). Its own header and footer (the other pages keep the site shell's), twelve
 * sections, and the few islands in ./clients. Light only, like the mock; its CSS is design/v9.css, every rule under `.v9`.
 */
export function V9Home({ t, lang }: { t: SiteT; lang: SiteLang }) {
  return (
    <div className="v9">
      <V9Hdr t={t} />
      <main id="main">
        <V9Hero t={t} />
        <V9Try t={t} />
        <V9Greet t={t} />
        <V9How t={t} />
        <V9Finder t={t} />
        <V9Voices t={t} />
        <V9Jobs t={t} />
        <V9Wit t={t} />
        <V9Guard t={t} />
        <V9Calc t={t} />
        <V9Pricing t={t} />
        <V9Faq t={t} />
        <V9Cta t={t} />
      </main>
      <V9Ftr t={t} lang={lang} />
      <Reveal />
    </div>
  );
}
