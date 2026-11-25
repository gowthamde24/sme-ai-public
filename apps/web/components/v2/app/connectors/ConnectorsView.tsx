"use client";

import Link from "next/link";
import * as React from "react";

import type { ConnectorsPage } from "@/lib/api/crm-push";

import { PageTop } from "../parts";
import { pageMain } from "../ui";
import { makeT, type Words } from "../words";
import type { ConnectorActions } from "./actions";
import { ConnectorCard } from "./ConnectorCard";

/** The chips under "Works with anything that can send a web request": names only, nothing to click. */
export const CHIPS = ["Google Sheets", "Google Forms", "Zapier", "Make", "n8n", "Pabbly Connect", "HubSpot", "Zoho CRM", "LeadSquared", "Sell.Do", "Pipedrive", "Freshsales", "Kylas", "Bitrix24", "Airtable", "Notion", "Salesforce", "Your own server"] as const;

/**
 * The Connectors page (docs/contracts/crm-push.md): where the results of calls and leads can be sent, a card for each tool. A card is a boxed thing you connect (the one place boxes are used here); everything else is flat. The web address card is the
 * outbound webhook path (Developers > Webhooks), shown here because it is how Zapier, Make, n8n and Pabbly are reached.
 */
export function ConnectorsView({ words, ui, page, actions, readOnly, webhooks, developersHref }: { words: Words; ui: string; page: ConnectorsPage; actions: ConnectorActions; readOnly: boolean; webhooks: { count: number } | null; developersHref: string }) {
  const t = makeT(words);
  const [openType, setOpenType] = React.useState<string | null>(null);
  return (
    <main className={pageMain} lang={ui}>
      <PageTop title={t("crm.title")} sub={t("crm.sub")} />
      <div className="mt-4 flex max-w-3xl flex-col gap-4">
        <p role="note" className="m-0 flex items-start gap-2 border-y border-line py-3 text-[15px] text-muted">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-muted" />
          <span>{t("crm.rules")}</span>
        </p>
        {readOnly ? (
          <p role="note" className="m-0 flex items-start gap-2 text-[15px] text-muted">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-muted" />
            <span>{t("crm.mock")}</span>
          </p>
        ) : null}
        {!page.available && !readOnly ? (
          <p role="note" className="m-0 flex items-start gap-2 text-[15px] text-ink">
            <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
            <span>{t("crm.unavailable")}</span>
          </p>
        ) : null}
        <section aria-label={t("crm.chip.title")} data-part="connector-chips">
          <h2 className="m-0 text-[15px] font-semibold text-ink">{t("crm.chip.title")}</h2>
          <ul lang="en" className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
            {CHIPS.map((c) => (
              <li key={c} className="rounded-full border border-line px-3 py-1 text-[14px] text-muted">
                {c}
              </li>
            ))}
          </ul>
        </section>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {page.items.map((card) => (
            <ConnectorCard key={card.type} card={card} words={words} events={page.events} actions={actions} readOnly={readOnly || !page.available} open={openType === card.type} onToggle={() => setOpenType((cur) => (cur === card.type ? null : card.type))} />
          ))}
          <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4" data-part="connector" data-type="web_address">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[17px] font-semibold text-ink">{t("crm.web.title")}</h2>
                <p className="m-0 mt-1 flex items-center gap-2 text-[14px] text-muted">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${webhooks && webhooks.count > 0 ? "bg-green-text" : "bg-muted"}`} />
                  {webhooks === null ? t("crm.web.off") : webhooks.count > 0 ? t("crm.web.count", { n: webhooks.count }) : t("crm.state.not")}
                </p>
              </div>
              {webhooks !== null ? (
                <Link href={`${developersHref}?tab=hooks`} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2">
                  {t("crm.web.open")}
                </Link>
              ) : null}
            </div>
            <p className="m-0 text-[15px] text-muted">{t("crm.web.sub")}</p>
          </li>
        </ul>
      </div>
    </main>
  );
}
