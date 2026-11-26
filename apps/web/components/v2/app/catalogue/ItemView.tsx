import Link from "next/link";

import type { Item } from "@/lib/api/catalogue";

import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { badge, card, okLine, primary, secondary } from "../visits/styles";
import { FreshPhotos } from "./FreshPhotos";
import { Gallery } from "./Gallery";
import { vocab } from "./ItemCard";
import { SendToCustomer } from "./SendToCustomer";
import { UndoPrice } from "./UndoPrice";
import type { SendActions } from "./catalogue-types";
import { soonestExpiry } from "./catalogue-logic";

/** "9 Nov, 3:40 pm" in the shop's own time (India). */
const changedAt = (iso: string): string => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** The saree's page (job BC): the big photos, the details in words, and, for the people who may, "Send to a customer" and Edit. A hidden saree is said to be hidden and cannot be sent. */
export function ItemView({ base, item, role, words, lead, saved, send, undo = null }: { base: string; item: Item; role: Role; words: TodayWords; lead: { leadId: string; label: string } | null; saved: boolean; send: SendActions | null ; /** "Undo price change" (the Owner only; the page passes it when the API says who last changed the item) */ undo?: (() => Promise<{ ok: true } | { ok: false; error: "nothing_to_undo" | "forbidden" | "invalid" | "mfa_required" | "down" }>) | null}) {
  const admin = role === "owner" || role === "admin";
  const rows: [string, React.ReactNode][] = [
    [say(words, "catalogue.field.fabric"), vocab(words, "fabric", item.fabric, item.fabric_label)],
    [say(words, "catalogue.field.colours"), item.colours.map((c) => vocab(words, "colour", c, c)).join(", ")],
    [say(words, "catalogue.field.zari"), say(words, `catalogue.zari.${item.zari}`)],
    [say(words, "catalogue.field.border"), item.border ?? say(words, "catalogue.field.none")],
    [say(words, "catalogue.field.occasions"), item.occasions.length ? item.occasions.map((o) => vocab(words, "occasion", o, o)).join(", ") : say(words, "catalogue.field.none")],
    [say(words, "catalogue.field.stock"), vocab(words, "stock", item.stock_status, item.stock_label)],
    [say(words, "catalogue.field.price_band"), item.price_band_label],
  ];
  if (item.price_text) rows.push([say(words, "catalogue.field.price"), <strong key="p">{item.price_text}</strong>]);
  return (
    <FreshPhotos seconds={soonestExpiry([item])}>
      <div data-screen="catalogue-item" className="flex flex-col gap-5">
        <p>
          <Link href={`${base}/catalogue${lead ? `?lead=${lead.leadId}` : ""}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-base font-semibold text-brand-text hover:underline">
            ← {say(words, "catalogue.item.back")}
          </Link>
        </p>
        {saved ? (
          <p role="status" className={okLine}>
            {say(words, item.active ? "catalogue.saved.shown" : "catalogue.saved.hidden", { name: item.name })}
          </p>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl md:leading-[1.1]">{item.name}</h1>
            <p className="flex flex-wrap gap-2">
              {!item.active ? <span data-badge="inactive" className={`${badge} border border-edge bg-surface-2 text-ink`}>{say(words, "catalogue.badge.inactive")}</span> : null}
              {item.stock_status === "few_left" ? <span data-badge="few_left" className={`${badge} bg-amber-bg text-amber-text`}>{say(words, "catalogue.stock.few_left")}</span> : null}
              {item.stock_status === "out_of_stock" ? <span data-badge="out_of_stock" className={`${badge} border border-ink font-bold text-ink`}>{say(words, "catalogue.stock.out_of_stock")}</span> : null}
              {item.stock_status === "made_to_order" ? <span data-badge="made_to_order" className={`${badge} bg-info-bg text-info-text`}>{say(words, "catalogue.stock.made_to_order")}</span> : null}
            </p>
            <p className="text-xl font-semibold">{item.price_text ?? item.price_band_label}</p>
            {item.updated_by_name !== undefined ? (
              <p data-part="last-changed" className="m-0 text-[15px] text-muted">
                {item.updated_by_name ? say(words, "catalogue.price.changed_by", { name: item.updated_by_name, when: changedAt(item.updated_at) }) : say(words, "catalogue.price.changed", { when: changedAt(item.updated_at) })}
              </p>
            ) : null}
            {/* eslint-disable-next-line react-hooks/purity -- the 30-day window only decides whether Undo is offered; the server enforces it */}
            {undo && role === "owner" && item.updated_by_name !== undefined && item.price_paise !== null && Date.now() - Date.parse(item.updated_at) < 30 * 86_400_000 ? <UndoPrice undo={undo} words={words} /> : null}
          </div>
          {admin ? (
            <Link href={`${base}/catalogue/${item.id}/edit`} className={secondary}>
              {say(words, "catalogue.item.edit")}
            </Link>
          ) : null}
        </header>

        {!item.active ? (
          <p role="note" className="rounded-xl bg-surface-2 px-4 py-3 text-base">
            {say(words, "catalogue.item.hidden")}
          </p>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]">
          <Gallery photos={item.photos} name={item.name} words={words} />
          <div className="flex min-w-0 flex-col gap-5">
            <dl className={`${card} grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2`} data-part="details">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-sm font-semibold text-muted">{k}</dt>
                  <dd className="min-w-0 text-base [overflow-wrap:anywhere]">{v}</dd>
                </div>
              ))}
            </dl>
            {send ? (
              item.active && item.photos.length > 0 ? (
                <SendToCustomer itemId={item.id} name={item.name} photos={item.photos} words={words} actions={send} lead={lead} outboxHref={`${base}/outbox`} todayHref={base} />
              ) : (
                <p className={`${card} text-base`} data-part="send-hidden">
                  {say(words, "catalogue.send.inactive")}{" "}
                  {admin ? (
                    <Link href={`${base}/catalogue/${item.id}/edit`} className={`${primary} mt-2`}>
                      {say(words, "catalogue.item.edit")}
                    </Link>
                  ) : null}
                </p>
              )
            ) : null}
          </div>
        </div>
      </div>
    </FreshPhotos>
  );
}
