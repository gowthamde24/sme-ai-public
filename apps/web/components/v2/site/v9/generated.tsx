// GENERATED ONCE from mocks/landing-v9/index.html by tools/c2-v9-convert.py (23 Nov 2026), then edited by hand. Server components: the words come from the string store (v9.*), the interactive parts are the islands in ./islands.
import Link from "next/link";

import { CookieSettingsLink } from "@/components/v2/legal/CookieSettingsLink";
import type { SiteLang } from "@/i18n/lang";
import { legalT } from "@/i18n/legal";
import type { SiteT } from "@/i18n/site";
import { BRAND_NAME } from "@/design/brand";
import { ADDRESSES, DOMAIN } from "@/lib/site/business";
import { websiteOnly } from "@/lib/site/mode";
import { sitePath } from "@/lib/site/paths";

import { Faq, HowDemo, JobsDemo, Phone, Pipe, TryIt, Voices } from "./islands";
import { MarkCrm, MarkForms, MarkMeta, MarkSheets, MarkToday, MarkUpload, MarkWhatsApp } from "./brands";
import { OrbRingLazy } from "./lazy";

export function V9Hdr({ t, home = "" }: { t: SiteT; /** "/" on a page that is not the home page: the in-page links then go to the home page's sections */ home?: string }) {
  return (
    <header className="hdr">
      <div className="hdr-in">
        <a href={`${home}#hero`} className="brand">
          <svg className="mark" width="28" height="28" viewBox="0 0 96 96" aria-hidden="true" fill="none" strokeWidth="18" strokeLinecap="round">
            <path d="M23 23h28" stroke="#c2410c" />
            <path d="M23 48h50" stroke="#16181d" />
            <path d="M45 73h28" stroke="#c2410c" strokeOpacity=".55" />
          </svg>
          <span>
            {t("v9.hdr.1")}
          </span>
        </a>
        <nav className="nav" aria-label={t("v9.hdr.2")}>
          <a href={`${home}#how`}>
            {t("v9.hdr.3")}
          </a>
          <a href={`${home}#finder`}>
            {t("v9.hdr.4")}
          </a>
          <a href={`${home}#voices`}>
            {t("v9.hdr.5")}
          </a>
          <a href={`${home}#pricing`}>
            {t("v9.hdr.6")}
          </a>
          <a href={`${home}#contact`}>
            {t("v9.hdr.7")}
          </a>
        </nav>
        <div className="hdr-acts">
          <span className="lang-chip">
            {t("v9.hdr.8")}
          </span>
          {websiteOnly() ? null : (
            <Link href="/login" prefetch={false} className="hdr-login">
              {t("h2.nav.login")}
            </Link>
          )}
          <a href={`${home}#early-access`} className="hdr-cta">
            {t("v9.hdr.9")}
          </a>
        </div>
      </div>
    </header>
  );
}

export function V9Hero({ t }: { t: SiteT }) {
  return (
    <section className="hero" id="hero">
      <div className="wrap">
        <div className="hero-top">
          <div className="eyebrow-pill">
            <span>
              {t("v9.hero.1")}
            </span>
            <a href="#voices">
              {t("v9.hero.2")}
            </a>
          </div>
          <h1>
            {t("v9.hero.3")}
          </h1>
          <p className="hero-sub">
            {t("v9.hero.4")}
          </p>
          <div className="hero-acts">
            <a href="#early-access" className="btn-primary">
              {t("v9.hero.5")}
            </a>
            <a href="#voices" className="text-link-cta">
              {t("v9.hero.2")}
            </a>
          </div>
          <div className="hero-trust">
            <p className="hero-trust-main">
              {t("v9.hero.6")}
            </p>
            <p className="hero-trust-quiet">
              {t("v9.hero.7")}
            </p>
          </div>
        </div>
        <div className="hero-stage">
          <div className="navy-object">
            <div className="cd">
              <div className="cd-top">
                <span className="cd-crumb">
                  {t("v9.hero.8")}
                  {" "}
                  <i>
                    {"/"}
                  </i>
                  {" "}
                  {t("v9.hero.9")}
                </span>
                <div className="cd-badges">
                  <span>
                    {t("v9.hero.10")}
                  </span>
                  <span>
                    {t("v9.hero.11")}
                  </span>
                  <span>
                    {t("v9.hero.12")}
                  </span>
                </div>
              </div>
              <div className="cd-tabs">
                <span className="on">
                  {t("v9.hero.13")}
                </span>
                <span>
                  {t("v9.hero.14")}
                </span>
              </div>
              <div className="cd-body">
                <div className="cd-main">
                  <h3>
                    {t("v9.hero.15")}
                  </h3>
                  <p>
                    {t("v9.hero.16")}
                  </p>
                  <div className="cd-next">
                    <small>
                      {t("v9.hero.17")}
                    </small>
                    <span>
                      {t("v9.hero.18")}
                    </span>
                  </div>
                </div>
                <dl className="cd-kv">
                  <div>
                    <dt>
                      {t("v9.hero.19")}
                    </dt>
                    <dd>
                      {"+91 98••• ••210"}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t("v9.hero.20")}
                    </dt>
                    <dd>
                      {t("v9.hero.21")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t("v9.hero.22")}
                    </dt>
                    <dd>
                      {t("v9.hero.23")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t("v9.hero.24")}
                    </dt>
                    <dd>
                      {t("v9.hero.25")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t("v9.hero.26")}
                    </dt>
                    <dd>
                      {t("v9.hero.27")}
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="cd-note">
                {t("v9.hero.28")}
              </p>
            </div>
          </div>
          <div className="hero-phone">
            <Phone t={t} id="ph-hero" still={false} />
          </div>
        </div>
        <div className="hero-cells">
          <div className="hero-cell">
            <i></i>
            {t("v9.hero.29")}
          </div>
          <div className="hero-cell">
            <i></i>
            {t("v9.hero.30")}
          </div>
          <div className="hero-cell">
            <i></i>
            {t("v9.hero.31")}
          </div>
        </div>
      </div>
    </section>
  );
}

export function V9Try({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-soft" id="try-it" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.try.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.try.2")}
          </h2>
          <p className="sec-sub">
            {t("v9.try.3")}
          </p>
        </header>
        <div className="appwin">
          <div className="aw-bar">
            <i></i>
            <i></i>
            <i></i>
            <span className="aw-url">
              {`app.${DOMAIN}/jobs`}
            </span>
          </div>
          <div className="aw-body">
            <aside className="aw-side">
              <div className="aw-brand">
                <svg className="mark" width="28" height="28" viewBox="0 0 96 96" aria-hidden="true" fill="none" strokeWidth="18" strokeLinecap="round">
                  <path d="M23 23h28" stroke="#ff9d6e" />
                  <path d="M23 48h50" stroke="#e9edf5" />
                  <path d="M45 73h28" stroke="#ff9d6e" strokeOpacity=".55" />
                </svg>
                {t("v9.try.5")}
              </div>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
                </svg>
                {t("v9.try.6")}
              </span>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
                </svg>
                {t("v9.try.7")}
              </span>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
                {t("v9.try.8")}
              </span>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 5h16v11H9l-5 4z" />
                </svg>
                {t("v9.try.9")}
              </span>
              <span className="aw-i on">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="7" width="18" height="13" rx="2" />
                  <path d="M9 7V5h6v2" />
                </svg>
                {t("v9.try.10")}
              </span>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 20V11M11 20V4M17 20v-7M3 20h18" />
                </svg>
                {t("v9.try.11")}
              </span>
              <span className="aw-i">
                <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
                  <circle cx="15" cy="7" r="2" />
                  <circle cx="9" cy="17" r="2" />
                </svg>
                {t("v9.try.12")}
              </span>
              <div className="aw-me">
                <b>
                  {t("v9.try.13")}
                </b>
                <span>
                  {t("v9.try.14")}
                </span>
              </div>
            </aside>
            <div className="aw-main">
              <div className="aw-top">
                <div>
                  <small>
                    {t("v9.try.10")}
                  </small>
                  <h3>
                    {t("v9.try.15")}
                  </h3>
                </div>
                <span className="aw-chip">
                  {t("v9.try.16")}
                </span>
              </div>
              <TryIt t={t} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function V9Greet({ t }: { t: SiteT }) {
  return (
    <section className="greet-sec" data-reveal="">
      <div className="gband" aria-hidden="true">
        <div className="gtrack">
          <div className="gmove">
            <div className="gset">
              <span className="gw" data-w="నమస్కారం"></span>
              <span className="gw" data-w="नमस्ते"></span>
              <span className="gw" data-w="ನಮಸ್ಕಾರ"></span>
              <span className="gw" data-w="Hello"></span>
            </div>
            <div className="gset">
              <span className="gw" data-w="నమస్కారం"></span>
              <span className="gw" data-w="नमस्ते"></span>
              <span className="gw" data-w="ನಮಸ್ಕಾರ"></span>
              <span className="gw" data-w="Hello"></span>
            </div>
          </div>
        </div>
        <div className="gspot">
          <div className="gmove">
            <div className="gset">
              <span className="gw" data-w="నమస్కారం"></span>
              <span className="gw" data-w="नमस्ते"></span>
              <span className="gw" data-w="ನಮಸ್ಕಾರ"></span>
              <span className="gw" data-w="Hello"></span>
            </div>
            <div className="gset">
              <span className="gw" data-w="నమస్కారం"></span>
              <span className="gw" data-w="नमस्ते"></span>
              <span className="gw" data-w="ನಮಸ್ಕಾರ"></span>
              <span className="gw" data-w="Hello"></span>
            </div>
          </div>
        </div>
      </div>
      <p className="greet-sub">
        {t("v9.greet.1")}
      </p>
    </section>
  );
}

export function V9How({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-soft" id="how" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.how.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.how.2")}
          </h2>
        </header>
        <HowDemo t={t} />
        <div className="flowline">
          <div className="flow-grp">
            <span className="flow-lbl">
              {t("v9.how.3")}
            </span>
            <span className="chip-item lg">
              <MarkForms />
              {t("v9.how.4")}
            </span>
            <span className="chip-item lg">
              <MarkWhatsApp />
              {t("v9.how.5")}
            </span>
            <span className="chip-item lg">
              <MarkUpload />
              {t("v9.how.6")}
            </span>
            <span className="chip-item lg chip-soon">
              <MarkSheets />
              {t("v9.how.7")}
            </span>
            <span className="chip-item lg chip-soon">
              <MarkMeta />
              {t("v9.how.8")}
            </span>
          </div>
          <span className="flow-arrow">
            {"→"}
          </span>
          <span className="flow-orb" aria-hidden="true">
            <OrbRingLazy state="ambient" size="xl" />
          </span>
          <span className="flow-arrow">
            {"→"}
          </span>
          <div className="flow-grp">
            <span className="flow-lbl">
              {t("v9.how.10")}
            </span>
            <span className="chip-item lg">
              <MarkWhatsApp />
              {t("v9.how.5")}
            </span>
            <span className="chip-item lg">
              <MarkToday />
              {t("v9.how.11")}
            </span>
            <span className="chip-item lg chip-soon">
              <MarkSheets />
              {t("v9.how.7")}
            </span>
            <span className="chip-item lg chip-soon">
              <MarkCrm />
              {t("v9.how.12")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function V9Finder({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" id="finder" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.finder.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.finder.2")}
          </h2>
          <p className="sec-sub">
            {t("v9.finder.3")}
          </p>
        </header>
        <div className="lf">
          <div className="lf-map">
            <svg className="lf-streets" viewBox="0 0 1060 540" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              <g fill="none" stroke="#dfe3ea" strokeWidth="10" strokeLinecap="round">
                <path d="M-20 120 C 220 150 380 60 620 110 S 900 190 1100 120" />
                <path d="M-20 420 C 200 380 420 470 640 420 S 920 380 1100 450" />
                <path d="M180 -20 C 210 180 150 330 220 560" />
                <path d="M520 -20 C 470 160 560 330 500 560" />
                <path d="M820 -20 C 860 200 770 350 840 560" />
              </g>
              <g fill="none" stroke="#eceff4" strokeWidth="5">
                <path d="M-20 270 C 260 290 420 230 700 280 S 960 300 1100 260" />
                <path d="M350 -20 C 330 200 380 330 330 560" />
                <path d="M690 -20 C 720 160 660 330 720 560" />
              </g>
            </svg>
            <span className="lf-ring lf-r3"></span>
            <span className="lf-ring lf-r2"></span>
            <span className="lf-ring lf-r1"></span>
            <span className="lf-sweep"></span>
            <span className="lf-me"></span>
            <span className="lf-me-l">
              {t("v9.finder.4")}
            </span>
            <div className="lf-pin p1">
              <i></i>
              <span>
                {t("v9.finder.5")}
              </span>
            </div>
            <div className="lf-pin p2">
              <i></i>
              <span>
                {t("v9.finder.6")}
              </span>
            </div>
            <div className="lf-pin p3">
              <i></i>
              <span>
                {t("v9.finder.7")}
              </span>
            </div>
            <div className="lf-pin p4">
              <i></i>
              <span>
                {t("v9.finder.8")}
              </span>
            </div>
          </div>
          <div className="lf-result">
            <small>
              {t("v9.finder.9")}
            </small>
            <h4>
              {t("v9.finder.10")}
            </h4>
            <p>
              {t("v9.finder.11")}
            </p>
            <div className="btns">
              <span className="b1">
                {t("v9.finder.12")}
              </span>
              <span className="b2">
                {t("v9.finder.13")}
              </span>
            </div>
            <p className="sample">
              {t("v9.finder.14")}
            </p>
          </div>
        </div>
        <div className="xprice" data-part="extra-searches">
          <h3>{t("v9.finder.price.title")}</h3>
          <ul>
            <li>
              <span>{t("v9.finder.17")}</span>
              <b>{t("v9.finder.16")}</b>
            </li>
            <li>
              <span>{t("v9.finder.19")}</span>
              <b>{t("v9.finder.18")}</b>
            </li>
            <li>
              <span>{t("v9.finder.21")}</span>
              <b>{t("v9.finder.20")}</b>
            </li>
          </ul>
          <p>{t("v9.finder.price.note")}</p>
        </div>
      </div>
    </section>
  );
}

export function V9Voices({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-soft" id="voices" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.voices.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.voices.2")}
          </h2>
        </header>
        <Voices t={t} />
        <p className="vnote">
          {t("v9.voices.3")}
        </p>
      </div>
    </section>
  );
}

export function V9Jobs({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" id="jobs" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.jobs.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.jobs.2")}
          </h2>
        </header>
        <JobsDemo t={t} />
      </div>
    </section>
  );
}

export function V9Wit({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-soft" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.wit.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.wit.2")}
          </h2>
          <p className="sec-sub">
            {t("v9.wit.3")}
          </p>
        </header>
        <div className="wit">
          <svg viewBox="0 0 1060 640" aria-hidden="true">
            <defs>
              <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1060" y2="0">
                <stop offset="0" stopColor="#c2410c" />
                <stop offset="1" stopColor="#fdba74" />
              </linearGradient>
            </defs>
            <path className="beam" d="M292 84 C 365 84 345 205 412 235" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="0s" repeatCount="indefinite" path="M292 84 C 365 84 345 205 412 235"></animateMotion>
            <path className="beam" d="M292 305 L 412 305" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="1.1s" repeatCount="indefinite" path="M292 305 L 412 305"></animateMotion>
            <path className="beam" d="M292 527 C 365 527 345 405 412 375" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="2.2s" repeatCount="indefinite" path="M292 527 C 365 527 345 405 412 375"></animateMotion>
            <path className="beam" d="M768 84 C 695 84 715 205 648 235" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="0.6s" repeatCount="indefinite" path="M768 84 C 695 84 715 205 648 235"></animateMotion>
            <path className="beam" d="M768 305 L 648 305" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="1.7s" repeatCount="indefinite" path="M768 305 L 648 305"></animateMotion>
            <path className="beam" d="M768 527 C 695 527 715 405 648 375" />
            <circle r="5.5" fill="#f97316" />
            <animateMotion dur="3.2s" begin="2.8s" repeatCount="indefinite" path="M768 527 C 695 527 715 405 648 375"></animateMotion>
          </svg>
          <Phone t={t} id="ph-wit" still={true} />
          <div className="wc c1">
            <span className="ic g">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16v11H9l-5 4z" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.4")}
              </small>
              <strong>
                {t("v9.wit.5")}
              </strong>
            </div>
          </div>
          <div className="wc c2">
            <span className="ic ">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="5" width="16" height="15" rx="2" />
                <path d="M4 10h16M8 3v4M16 3v4" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.6")}
              </small>
              <strong>
                {t("v9.wit.7")}
              </strong>
            </div>
          </div>
          <div className="wc c3">
            <span className="ic n">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.8")}
              </small>
              <strong>
                {t("v9.wit.9")}
              </strong>
            </div>
          </div>
          <div className="wc c4">
            <span className="ic ">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.10")}
              </small>
              <strong>
                {t("v9.wit.11")}
              </strong>
            </div>
          </div>
          <div className="wc c5">
            <span className="ic n">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 17v-6a6 6 0 1 1 12 0v6l2 2H4z" />
                <path d="M10 21h4" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.12")}
              </small>
              <strong>
                {t("v9.wit.13")}
              </strong>
            </div>
          </div>
          <div className="wc c6">
            <span className="ic n">
              <svg className="ico" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M4 10h16M4 15h16M10 4v16" />
              </svg>
            </span>
            <div>
              <small>
                {t("v9.wit.14")}
              </small>
              <strong>
                {t("v9.wit.15")}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function V9Guard({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.guard.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.guard.2")}
          </h2>
        </header>
        <div className="g8">
          <article className="gt a">
            <h3>
              {t("v9.guard.3")}
            </h3>
            <p>
              {t("v9.guard.4")}
            </p>
            <div className="consent">
              <div className="m cu">
                {t("v9.guard.5")}
              </div>
              <div className="cc">
                <i></i>
                {t("v9.guard.6")}
                <em>
                  {t("v9.guard.7")}
                </em>
              </div>
              <div className="m cs">
                {t("v9.guard.8")}
              </div>
            </div>
          </article>
          <article className="gt b">
            <h3>
              {t("v9.guard.9")}
            </h3>
            <p>
              {t("v9.guard.10")}
            </p>
            <div className="kyc">
              <div className="kyc-card">
                <b>
                  {t("v9.guard.11")}
                </b>
                <div className="ln"></div>
                <div className="ln s"></div>
                <span className="kyc-stamp">
                  {t("v9.guard.12")}
                </span>
              </div>
              <span className="kyc-arrow">
                {"→"}
              </span>
              <div className="kyc-num">
                <small>
                  {t("v9.guard.13")}
                </small>
                {t("v9.guard.14")}
              </div>
            </div>
            <p className="kyc-note">
              {t("v9.guard.landline")}
            </p>
          </article>
          <article className="gt c">
            <h3>
              {t("v9.guard.15")}
            </h3>
            <p>
              {t("v9.guard.16")}
            </p>
            <div className="dial">
              <svg viewBox="0 0 150 150" aria-hidden="true">
                <circle cx="75" cy="75" r="62" fill="none" stroke="#e8eaf0" strokeWidth="14" />
                <path d="M31.2 31.2 A62 62 0 0 1 118.8 118.8" fill="none" stroke="#0b1020" strokeWidth="14" strokeLinecap="round" />
                <text x="75" y="48" textAnchor="middle" fontSize="22" fill="#0b1020" fontFamily="inherit">
                  {"☾"}
                </text>
                <g className="hand">
                  <line x1="75" y1="75" x2="75" y2="21" stroke="#f97316" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="75" cy="15" r="6" fill="#f97316" />
                </g>
              </svg>
            </div>
            <div className="dial-c">
              {t("v9.guard.18")}
            </div>
          </article>
          <article className="gt d">
            <h3>
              {t("v9.guard.19")}
              {" "}
              <span className="tag-ex">
                {t("v9.guard.20")}
              </span>
            </h3>
            <p>
              {t("v9.guard.21")}
            </p>
            <ol className="tl" data-part="retry-steps">
              {(["1", "2", "3"] as const).map((n) => (
                <li key={n}>
                  <i aria-hidden="true" />
                  <b>{t(`v9.guard.t${n}.time` as "v9.guard.t1.time")}</b>
                  <span>{t(`v9.guard.t${n}.what` as "v9.guard.t1.what")}</span>
                </li>
              ))}
            </ol>
          </article>
          <article className="gt e">
            <h3>
              {t("v9.guard.25")}
            </h3>
            <div className="lim">
              <span>
                {t("v9.guard.26")}
              </span>
              <span>
                {t("v9.guard.27")}
              </span>
              <span>
                {t("v9.guard.28")}
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

export function V9Calc({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-soft" id="calc" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.calc.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.calc.2")}
          </h2>
          <p className="sec-sub">
            {t("v9.calc.3")}
          </p>
        </header>
        <Pipe t={t} />
        <p className="pipe-cap">
          {t("v9.calc.4")}
        </p>
      </div>
    </section>
  );
}

export function V9Pricing({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" id="pricing" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.pricing.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.pricing.2")}
          </h2>
          <p className="sec-sub">
            {t("v9.pricing.3")}
          </p>
        </header>
        <div className="plans8">
          <article className="pc8 ">
            <div className="top">
              <h3>
                {t("v9.pricing.4")}
              </h3>
            </div>
            <p className="pr">
              {t("v9.pricing.5")}
              <span>
                {t("v9.pricing.6")}
              </span>
            </p>
            <p className="for">
              {t("v9.pricing.7")}
            </p>
            <ul>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.8")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.9")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.10")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.11")}
                </span>
              </li>
            </ul>
            <div className="go">
              <a href="#early-access">
                {t("v9.pricing.12")}
              </a>
            </div>
          </article>
          <article className="pc8 pro">
            <div className="top">
              <h3>
                {t("v9.pricing.13")}
              </h3>
              <span className="rec">
                {t("v9.pricing.14")}
              </span>
            </div>
            <p className="pr">
              {t("v9.pricing.15")}
              <span>
                {t("v9.pricing.6")}
              </span>
            </p>
            <p className="for">
              {t("v9.pricing.16")}
            </p>
            <ul>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.17")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.18")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.19")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.10")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.11")}
                </span>
              </li>
            </ul>
            <div className="go">
              <a href="#early-access">
                {t("v9.pricing.12")}
              </a>
            </div>
          </article>
          <article className="pc8 ">
            <div className="top">
              <h3>
                {t("v9.pricing.20")}
              </h3>
            </div>
            <p className="pr">
              {t("v9.pricing.21")}
              <span>
                {t("v9.pricing.6")}
              </span>
            </p>
            <p className="for">
              {t("v9.pricing.22")}
            </p>
            <ul>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.23")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.18")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.24")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.10")}
                </span>
              </li>
              <li>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m20 6-11 11-5-5" />
                </svg>
                <span>
                  {t("v9.pricing.25")}
                </span>
              </li>
            </ul>
            <div className="go">
              <a href="#early-access">
                {t("v9.pricing.12")}
              </a>
            </div>
          </article>
        </div>
        <div className="every8">
          <p>
            {t("v9.pricing.26")}
          </p>
          <div>
            <span>
              {t("v9.pricing.27")}
            </span>
            <span>
              {t("v9.pricing.28")}
            </span>
            <span>
              {t("v9.pricing.29")}
            </span>
            <span>
              {t("v9.pricing.30")}
            </span>
            <span>
              {t("v9.pricing.31")}
            </span>
            <span>
              {t("v9.pricing.32")}
            </span>
          </div>
        </div>
        <p className="gst8">
          <b>
            {t("v9.pricing.33")}
          </b>
          {" "}
          {t("v9.pricing.34")}
        </p>
      </div>
    </section>
  );
}

export function V9Faq({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" id="faq" data-reveal="">
      <div className="wrap">
        <header className="sec-head">
          <p className="sec-eye">
            {t("v9.faq.1")}
          </p>
          <h2 className="sec-h2">
            {t("v9.faq.2")}
          </h2>
        </header>
        <Faq t={t} />
      </div>
    </section>
  );
}

export function V9Cta({ t }: { t: SiteT }) {
  return (
    <section className="sec sec-white" id="early-access" data-reveal="">
      <div className="wrap">
        <div className="cta-card" id="contact">
          <h2>
            {t("v9.cta.1")}
            <br />
            {t("v9.cta.2")}
          </h2>
          <div className="cta-acts">
            <a href={`mailto:${ADDRESSES.hello}?subject=Early%20access`} className="btn-primary">
              {t("v9.cta.3")}
            </a>
            <p className="cta-wa">
              {t("v9.cta.4")}
              {" "}
              <a href={`mailto:${ADDRESSES.hello}`}>
                {ADDRESSES.hello}
              </a>
            </p>
            <p className="cta-honest">
              {t("v9.cta.6")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function V9Ftr({ t, lang, home = "" }: { t: SiteT; lang: SiteLang; /** "/" on a page that is not the home page */ home?: string }) {
  const legal = legalT(lang === "ta" ? "en" : lang);
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-cols">
          <div className="ftr-col">
            <h3>
              {t("v9.ftr.1")}
            </h3>
            <ul>
              <li>
                <a href={`${home}#how`}>
                  {t("v9.ftr.2")}
                </a>
              </li>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.3")}
                </a>
              </li>
              <li>
                <a href={`${home}#finder`}>
                  {t("v9.ftr.4")}
                </a>
              </li>
              <li>
                <a href={`${home}#pricing`}>
                  {t("v9.ftr.5")}
                </a>
              </li>
            </ul>
          </div>
          <div className="ftr-col">
            <h3>
              {t("v9.ftr.6")}
            </h3>
            <ul>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.7")}
                </a>
              </li>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.8")}
                </a>
              </li>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.9")}
                </a>
              </li>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.10")}
                </a>
              </li>
              <li>
                <a href={`${home}#voices`}>
                  {t("v9.ftr.11")}
                </a>
              </li>
            </ul>
          </div>
          <div className="ftr-col">
            <h3>
              {t("v9.ftr.12")}
            </h3>
            <ul>
              <li>
                <a href={`${home}#how`}>
                  {t("v9.ftr.13")}
                </a>
              </li>
              <li>
                <a href={`${home}#how`}>
                  {t("v9.ftr.14")}
                </a>
              </li>
              <li>
                <a href={`${home}#how`}>
                  {t("v9.ftr.15")}
                </a>
              </li>
              <li>
                <a href={`${home}#how`}>
                  {t("v9.ftr.16")}
                </a>
              </li>
            </ul>
          </div>
          <div className="ftr-col">
            <h3>
              {t("v9.ftr.17")}
            </h3>
            <ul>
              <li>
                <a href={`${home}#calc`}>
                  {t("v9.ftr.18")}
                </a>
              </li>
              <li>
                <a href={`${home}#faq`}>
                  {t("v9.ftr.19")}
                </a>
              </li>
              <li>
                <a href={`${home}#try-it`}>
                  {t("v9.ftr.20")}
                </a>
              </li>
            </ul>
          </div>
          <div className="ftr-col">
            <h3>
              {t("v9.ftr.21")}
            </h3>
            <ul>
              <li>
                <a href={`${home}#contact`}>
                  {t("v9.ftr.22")}
                </a>
              </li>
              <li>
                <Link href="/privacy" prefetch={false}>
                  {t("v9.ftr.23")}
                </Link>
              </li>
              <li>
                <Link href="/terms" prefetch={false}>
                  {t("v9.ftr.24")}
                </Link>
              </li>
              <li>
                <Link href="/data-deletion" prefetch={false}>
                  {t("v9.ftr.25")}
                </Link>
              </li>
              <li>
                <CookieSettingsLink label={legal("legal.cookies.link")} />
              </li>
            </ul>
          </div>
        </div>
        <div className="ftr-meta">
          <div className="ftr-langs">
            <a href={sitePath("en", { kind: "home" })} lang="en" hrefLang="en" aria-current={lang === "en" ? "true" : undefined}>
              {t("v9.ftr.16")}
            </a>
            <a href={sitePath("te", { kind: "home" })} lang="te" hrefLang="te" aria-current={lang === "te" ? "true" : undefined}>
              {t("v9.ftr.26")}
            </a>
            <a href={sitePath("hi", { kind: "home" })} lang="hi" hrefLang="hi" aria-current={lang === "hi" ? "true" : undefined}>
              {t("v9.ftr.27")}
            </a>
            <a href={sitePath("kn", { kind: "home" })} lang="kn" hrefLang="kn" aria-current={lang === "kn" ? "true" : undefined}>
              {t("v9.ftr.28")}
            </a>
          </div>
          <span className="voices-by">
            {t("v9.ftr.29")}
            {" "}
            <svg className="cartesia-logo" viewBox="0 0 579 83" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={t("v9.ftr.30")}>
              <path data-slot="mark" d="M89.1256 28.6346V51.252H77.9183L76.4474 49.2161L72.9215 44.3358L70.5208 41.0131L66.4165 35.3331L67.6578 41.0131L69.4514 49.2161L69.8956 51.252L71.245 57.4192L72.9215 65.092L73.0376 65.6225L74.8301 73.8241L76.6237 82.0274H51.3153L49.5216 73.8241L48.6137 69.6692L47.7291 65.6225L45.9355 57.4192L44.5874 51.252L43.2394 57.4192L41.4457 65.6225L40.5122 69.8934L39.6532 73.8241L37.8595 82.0274H12.5021L14.2958 73.8241L16.0393 65.8445V65.8435L16.2042 65.7215L16.339 65.6225L24.3069 59.7214L27.4162 57.4192L32.4095 53.7207L35.7439 51.252H0V28.6346H24.1731L24.3069 28.0255L25.0544 24.6081L26.8469 16.405L28.6406 8.2019L30.4331 0H58.6925L60.485 8.2019L60.8605 9.9186L56.7162 12.9875L52.1007 16.405L48.6137 18.9878L41.0246 24.6081L40.5122 24.987L35.5868 28.6346H89.1256Z" fill="currentColor" />
              <g data-slot="wordmark">
                <path d="M533.321 73.5189H512.402V69.1647H517.986L540.42 8.11005H550.927L573.172 69.1647H578.946V73.5189H552.253V69.1647H561.34L554.619 50.3277H530.765L524.139 69.1647H533.321V73.5189ZM532.185 46.068H553.199C545.343 23.634 543.828 19.0904 542.787 15.7774C541.746 18.9958 540.136 23.634 532.185 46.068Z" fill="currentColor" />
                <path d="M509.259 73.5189H483.512V69.1647H490.896V12.4643H483.512V8.11005H509.259V12.4643H501.876V69.1647H509.259V73.5189Z" fill="currentColor" />
                <path d="M425.863 53.6412H435.708V54.8717C435.708 65.0001 441.292 70.301 451.894 70.301C463.159 70.301 467.797 65.4734 467.797 58.2794C467.797 51.8426 465.241 48.4349 454.071 46.2578L444.511 44.3646C432.963 42.1875 428.04 36.9813 428.04 25.9063C428.04 15.6832 434.761 6.97461 453.125 6.97461C469.69 6.97461 476.695 13.2221 476.695 25.433V26.2849H467.418V25.433C467.418 16.8191 464.2 11.2342 452.935 11.2342C441.198 11.2342 437.79 17.103 437.79 23.3505C437.79 29.4086 440.63 33.2896 450.285 35.1828L460.129 37.0759C473.003 39.5371 477.925 44.1753 477.925 55.4397C477.925 68.6918 467.986 74.6553 451.705 74.6553C433.53 74.6553 425.863 67.1773 425.863 54.5877V53.6412Z" fill="currentColor" />
                <path d="M345.828 73.5189H320.081V69.1647H327.464V12.4643H311.514L309.811 23.8233H302.333L304.462 8.11005H361.541L363.67 23.8233H356.287L354.584 12.4643H338.444V69.1647H345.828V73.5189Z" fill="currentColor" />
                <path d="M193.568 73.5189H172.649V69.1647H178.234L200.668 8.11005H211.175L233.42 69.1647H239.194V73.5189H212.5V69.1647H221.587L214.867 50.3277H191.013L184.387 69.1647H193.568V73.5189ZM192.433 46.068H213.447C205.59 23.634 204.075 19.0904 203.034 15.7774C201.993 18.9958 200.384 23.634 192.433 46.068Z" fill="currentColor" />
                <path d="M172.479 51.464V51.9373C172.479 65.0001 164.433 74.6553 145.88 74.6553C125.623 74.6553 115.968 64.0536 115.968 40.673C115.968 17.5763 127.516 6.97461 146.448 6.97461C164.244 6.97461 172.479 15.7778 172.479 30.5445V31.1125H162.066V30.5445C162.066 20.2268 159.132 11.3289 146.448 11.3289C134.426 11.3289 127.421 19.4695 127.421 40.5783C127.421 65.7574 136.225 70.2064 146.258 70.2064C157.333 70.2064 162.256 63.4856 162.256 52.032V51.464H172.479Z" fill="currentColor" />
                <path d="M418.784 23.8233H411.401L409.271 12.4643H386.459V37.3596H400.171V30.072H405.765V49.2489H400.171V41.7138H386.459V69.1646H412.158L413.862 56.7645H421.15L419.021 73.5188H368.095V69.1646H375.478V12.4643H368.095V8.11005H416.654L418.784 23.8233Z" fill="currentColor" />
                <path d="M266.645 8.11005C271.946 8.11005 277.815 8.39407 281.791 9.05667C291.162 10.5712 295.422 16.5348 295.422 26.0006C295.422 34.8037 291.825 40.0099 283.022 43.0389L297.409 69.1646H302.258V54.3422H307.852V73.5192L287.281 73.5188L272.609 45.027C270.527 45.2163 268.35 45.3106 266.362 45.3106H260.777V69.1646H268.823V73.5188H242.413V69.1646H249.796V12.4643H242.413V8.11005H266.645ZM260.777 40.862H267.781C272.23 40.862 276.017 40.1994 278.383 38.7796C282.17 36.6971 284.063 32.6265 284.063 26.3791C284.063 19.0904 281.601 15.3988 276.585 13.6949C274.691 13.0324 270.621 12.4643 267.498 12.4643H260.777V40.862Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
              </g>
            </svg>
          </span>
        </div>
        <p className="ftr-tm">
          {t("v9.ftr.tm")}
        </p>
      </div>
      <div className="wm-box" aria-hidden="true">
        <div className="wm">
          <span className="wm-bar wm-b1"></span>
          <span className="wm-bar wm-b2"></span>
          <span className="wm-bar wm-b3"></span>
          <span className="wm-t" data-name={BRAND_NAME}></span>
        </div>
      </div>
    </footer>
  );
}

