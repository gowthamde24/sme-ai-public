"use client";

import * as React from "react";

import type { CommerceData, ShopKind } from "@/lib/api/commerce-notify";

import { makeT, type Words } from "../words";
import type { CommerceActions } from "./actions";
import { CalendarCard } from "./CalendarCard";
import { FormTemplates } from "./FormTemplates";
import { NotifyCard } from "./NotifyCard";
import { Notice } from "./parts";
import { ShopCard } from "./ShopCard";

const SHOPS: ShopKind[] = ["shopify", "woocommerce"];
const REASONS_BACK = ["connected", "denied", "expired", "missing_scope", "error", "invalid", "needs_setup"];

/**
 * The commerce, messages and calendar cards for the Connectors page (docs/contracts/commerce-notify.md section E). MOUNT: render it under the CRM cards of the Connectors page, with `words = wordsFor(ui, ["cn."])`, the data of
 * `loadCommerceData(token, tenantId)` (lib/api/commerce-notify.ts) and `actions = bindActions(tenantId, moves)`. A group whose API switch is off is `null` in `data` and is not drawn; with all four `null` nothing is drawn.
 * `readOnly` draws the sample screens with every button off. `outlookResult` is the `?calendar_outlook=` word Microsoft's callback sends the browser back with.
 */
export function CommerceConnectors({ words, ui, data, actions, readOnly = false, outlookResult = null }: { words: Words; ui: string; data: CommerceData; actions: CommerceActions; readOnly?: boolean; outlookResult?: string | null }) {
  const t = makeT(words);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const toggle = (id: string) => () => setOpenId((c) => (c === id ? null : id));
  const none = !data.shops && !data.notify && !data.calendars && !data.forms;
  if (none) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-6" lang={ui} data-part="commerce-connectors">
      {readOnly ? <Notice>{t("cn.mock")}</Notice> : null}
      {outlookResult && REASONS_BACK.includes(outlookResult) ? <Notice tone={outlookResult === "connected" ? "plain" : "brand"} role="status">{t(`cn.outlook.back.${outlookResult}`)}</Notice> : null}
      {data.shops ? (
        <section aria-labelledby="cn-shops" data-part="commerce-group" data-group="shops">
          <h2 id="cn-shops" className="m-0 text-[17px] font-semibold text-ink">{t("cn.group.shops")}</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">{t("cn.group.shops.sub")}</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {SHOPS.map((kind) => (
              <ShopCard key={kind} kind={kind} connection={data.shops?.find((c) => c.kind === kind) ?? null} lists={data.lists} words={words} actions={actions} readOnly={readOnly} open={openId === kind} onToggle={toggle(kind)} />
            ))}
          </ul>
        </section>
      ) : null}
      {data.notify ? (
        <section aria-labelledby="cn-notify" data-part="commerce-group" data-group="notify">
          <h2 id="cn-notify" className="m-0 text-[17px] font-semibold text-ink">{t("cn.group.notify")}</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">{t("cn.group.notify.sub")}</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {data.notify.channels.map((c) => {
              const page = data.notify;
              return page ? <NotifyCard key={c.kind} channel={c} page={page} words={words} actions={actions} readOnly={readOnly} open={openId === c.kind} onToggle={toggle(c.kind)} /> : null;
            })}
          </ul>
        </section>
      ) : null}
      {data.calendars ? (
        <section aria-labelledby="cn-calendars" data-part="commerce-group" data-group="calendars">
          <h2 id="cn-calendars" className="m-0 text-[17px] font-semibold text-ink">{t("cn.group.calendars")}</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">{t("cn.group.calendars.sub")}</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {data.calendars.items.map((c) => (
              <CalendarCard key={c.kind} calendar={c} words={words} actions={actions} readOnly={readOnly} open={openId === c.kind} onToggle={toggle(c.kind)} />
            ))}
          </ul>
          {data.calendars.needsPerson.length > 0 ? (
            <div className="mt-3" data-part="needs-person">
              <h3 className="m-0 text-[15px] font-semibold text-ink">{t("cn.np.title")}</h3>
              <p className="m-0 mt-1 text-[14px] text-muted">{t("cn.np.sub")}</p>
              <ul className="m-0 mt-2 flex list-none flex-col p-0">
                {data.calendars.needsPerson.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-2 text-[15px]">
                    <span className="text-ink">{["calendly", "calcom"].includes(b.kind) ? (b.kind === "calendly" ? "Calendly" : "Cal.com") : b.kind}</span>
                    <span className="text-muted">{["no_lead", "closed", "slot", "full", "past"].includes(b.reason) ? t(`cn.np.${b.reason}`) : t("cn.np.other")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      {data.forms ? (
        <section aria-labelledby="cn-forms" data-part="commerce-group" data-group="forms">
          <h2 id="cn-forms" className="m-0 text-[17px] font-semibold text-ink">{t("cn.group.forms")}</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">{t("cn.group.forms.sub")}</p>
          <div className="mt-3">
            <FormTemplates items={data.forms} words={words} actions={actions} readOnly={readOnly} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
