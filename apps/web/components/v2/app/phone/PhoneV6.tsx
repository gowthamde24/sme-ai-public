import type { ReactNode } from "react";

import type { PhoneNumber } from "@/lib/phone-number/types";

import { EmptyNext } from "../ds/EmptyNext";
import { PageHeader } from "../ds/PageHeader";
import { StatusPill, type Status } from "../ds/StatusPill";
import { pageMain } from "../ui";
import { card } from "../v6/ui";
import { makeT, type Words } from "../words";

const STATE_STATUS: Record<PhoneNumber["state"], Status> = { not_set_up: "no_answer", kyc_pending: "spam", active: "completed" };

/**
 * Phone numbers of design system v6 (owner 13 Nov 2026): the page header with the "?", a plain-language card that says where the business number stands (not set up, waiting for approval, active) in one of the status colours, and below it the Settings >
 * Phone number test screen's own panel (Edit = the city, ONE main button: Get this number, then Ring my phone to test). `phone` is null where the test screen is not on: the page then shows its next step (use the WhatsApp number meanwhile). Nothing is bought, rented or rung.
 */
export function PhoneV6({ words, lang, title, help, phone, panel, connectHref, voiceLink = null }: { words: Words; lang: string; title: string; help: ReactNode; phone: PhoneNumber | null; panel: ReactNode; connectHref: string; voiceLink?: ReactNode }) {
  const t = makeT(words);
  const state = phone?.state ?? "not_set_up";
  return (
    <main className={pageMain} lang={lang} data-part="phone-v6">
      <PageHeader title={title} sub={t("phv6.sub")} right={help} />
      <section aria-labelledby="phv6-status" data-part="phone-status" data-phone-state={state} className={`${card} mt-5 max-w-2xl`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="phv6-status" className="font-display text-xl font-semibold">
            {t("phv6.card.title")}
          </h2>
          <StatusPill status={STATE_STATUS[state]}>{t(`phv6.state.${state}`)}</StatusPill>
        </div>
        <p className="mt-2 text-base text-muted">{t(`phv6.text.${state}`)}</p>
        {phone?.number ? <p className="mt-3 font-mono text-2xl font-semibold" data-part="phone-digits">{phone.number}</p> : null}
      </section>
      {phone === null ? (
        <div className="mt-6">
          <EmptyNext title={t("phv6.empty.title")} text={t("phv6.empty.text")} action={{ href: connectHref, label: t("phv6.empty.action") }} />
        </div>
      ) : (
        <div className="mt-4">{panel}</div>
      )}
      {voiceLink}
    </main>
  );
}
