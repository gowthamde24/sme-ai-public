"use client";

import * as React from "react";

import { CONFIRM_ORDERS, type CatalogueRow, type ManualSetup, type Preview, type ProductsList, type ShopConnection, type ShopKind } from "@/lib/api/commerce-notify";

import { btnMain, btnQuiet } from "../ui";
import { makeT, type Words } from "../words";
import type { CommerceActions } from "./actions";
import { CardBox, CheckField, CopyField, Disconnect, Notice, Result, SelectField, TextField, useRunner, when } from "./parts";

const NAME: Record<ShopKind, string> = { shopify: "Shopify", woocommerce: "WooCommerce" };
const STEPS: Record<ShopKind, number> = { shopify: 4, woocommerce: 4 };
const rupees = (paise: number): string => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * An online store (docs/contracts/commerce-notify.md section B): the steps to do in the store, the plain connect form (a labelled field for each key), then, once connected, how its orders are handled (plain labelled choices),
 * Test, the "fill a list from my store" step (preview first, nothing saved until the owner says), and Disconnect. A key lives in this component's state only while it is being typed and is cleared the moment it is sent.
 */
export function ShopCard({ kind, connection, lists, words, actions, readOnly, open, onToggle }: { kind: ShopKind; connection: ShopConnection | null; lists: ProductsList[] | null; words: Words; actions: CommerceActions; readOnly: boolean; open: boolean; onToggle: () => void }) {
  const t = makeT(words);
  const r = useRunner(t);
  const [conn, setConn] = React.useState<ShopConnection | null>(connection);
  const [manual, setManual] = React.useState<ManualSetup | null>(null);
  const [tested, setTested] = React.useState<boolean | null>(null);
  const state = !conn ? "not_connected" : conn.state === "problem" ? "problem" : "connected";
  const stateText = t(`cn.state.${state === "not_connected" ? "not" : state}`);
  const off = r.busy || readOnly;
  return (
    <CardBox id={kind} group="shops" title={NAME[kind]} state={state} stateText={stateText} open={open} onToggle={onToggle} openWord={t("cn.open")} closeWord={t("cn.close")}>
      {r.problem ? <Notice role="alert" tone="brand">{r.problem}</Notice> : null}
      {r.note ? <Notice role="status">{r.note}</Notice> : null}
      {manual ? <ManualBox words={words} manual={manual} onDone={() => setManual(null)} /> : null}
      {!conn ? (
        <>
          <div>
            <h4 className="m-0 text-[15px] font-semibold text-ink">{t("cn.shop.before")}</h4>
            <ol className="m-0 mt-1 list-decimal pl-5 text-[15px] text-muted">
              {Array.from({ length: STEPS[kind] }, (_, i) => (
                <li key={i}>{t(`cn.shop.${kind}.step.${i + 1}`)}</li>
              ))}
            </ol>
          </div>
          <ConnectForm kind={kind} words={words} busy={off} onSend={(input) => void r.run(() => (kind === "shopify" ? actions.connectShopify({ id: crypto.randomUUID(), ...(input as ShopifyFields) }) : actions.connectWoo({ id: crypto.randomUUID(), ...(input as WooFields) })), (x) => { setConn(x.card.connection); setManual(x.card.manual); r.setNote(t("cn.shop.connected")); })} />
        </>
      ) : (
        <>
          {conn.state === "problem" ? <Notice tone="brand" role="status">{t(`cn.reason.${conn.problem ?? "unreachable"}`)}</Notice> : null}
          <p className="m-0 text-[14px] text-muted" data-part="shop-facts">
            {conn.storeLabel} · {conn.last4 ? `${t("cn.last4", { last4: conn.last4 })} · ` : ""}{t("cn.shop.counts", { orders: conn.orders30d, cod: conn.cod30d, carts: conn.cartsWaiting })} {conn.lastEventAt ? t("cn.shop.last", { when: when(conn.lastEventAt) }) : t("cn.shop.none")}
          </p>
          <Choices key={JSON.stringify(conn.settings)} conn={conn} words={words} busy={off} onSave={(patch) => void r.run(() => actions.changeShop(conn.id, patch), (x) => { setConn(x.connection); r.setNote(t("cn.saved")); })} />
          <div className="flex flex-wrap gap-x-1 gap-y-1">
            <button type="button" disabled={off} className={btnMain} onClick={() => void r.run(() => actions.testShop(conn.id), (x) => { setConn(x.connection); setTested(x.connection.state === "connected"); })}>
              {t("cn.test.keys")}
            </button>
          </div>
          {tested !== null ? <Result ok={tested} text={tested ? t("cn.shop.test.ok") : t("cn.shop.test.bad")} /> : null}
          <Catalogue connection={conn} lists={lists} words={words} busy={off} actions={actions} />
          <Disconnect words={words} name={NAME[kind]} busy={off} onYes={() => void r.run(() => actions.disconnectShop(conn.id), () => { setConn(null); setTested(null); })} />
        </>
      )}
    </CardBox>
  );
}

type ShopifyFields = { shop: string; clientSecret: string; accessToken?: string; clientId?: string };
type WooFields = { site: string; key: string; secret: string };

function ConnectForm({ kind, words, busy, onSend }: { kind: ShopKind; words: Words; busy: boolean; onSend: (v: ShopifyFields | WooFields) => void }) {
  const t = makeT(words);
  const [f, setF] = React.useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setF((c) => ({ ...c, [k]: v }));
  const get = (k: string) => (f[k] ?? "").trim();
  const valid = kind === "shopify" ? get("shop") !== "" && get("clientSecret").length >= 8 && (get("accessToken") !== "") !== (get("clientId") !== "") : get("site") !== "" && get("key").length >= 8 && get("secret").length >= 8;
  return (
    <form
      className="flex flex-col gap-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSend(kind === "shopify" ? { shop: get("shop"), clientSecret: get("clientSecret"), ...(get("accessToken") ? { accessToken: get("accessToken") } : {}), ...(get("clientId") ? { clientId: get("clientId") } : {}) } : { site: get("site"), key: get("key"), secret: get("secret") });
        setF({}); // a key is never kept after it is sent
      }}
    >
      <p className="m-0 text-[14px] text-muted">{t("cn.keys.note")}</p>
      {kind === "shopify" ? (
        <>
          <TextField id="shopify-shop" label={t("cn.shopify.shop")} hint={t("cn.shopify.shop.hint")} value={f.shop ?? ""} onChange={set("shop")} lang="en" placeholder="my-shop.myshopify.com" />
          <TextField id="shopify-token" label={t("cn.shopify.token")} hint={t("cn.shopify.token.hint")} value={f.accessToken ?? ""} onChange={set("accessToken")} secret lang="en" />
          <TextField id="shopify-client" label={t("cn.shopify.client")} hint={t("cn.shopify.client.hint")} value={f.clientId ?? ""} onChange={set("clientId")} lang="en" />
          <TextField id="shopify-secret" label={t("cn.shopify.secret")} hint={t("cn.shopify.secret.hint")} value={f.clientSecret ?? ""} onChange={set("clientSecret")} secret lang="en" />
        </>
      ) : (
        <>
          <TextField id="woo-site" label={t("cn.woo.site")} hint={t("cn.woo.site.hint")} value={f.site ?? ""} onChange={set("site")} lang="en" placeholder="https://shop.example.com" />
          <TextField id="woo-key" label={t("cn.woo.key")} hint={t("cn.woo.key.hint")} value={f.key ?? ""} onChange={set("key")} secret lang="en" />
          <TextField id="woo-secret" label={t("cn.woo.secret")} value={f.secret ?? ""} onChange={set("secret")} secret lang="en" />
        </>
      )}
      <div>
        <button type="submit" disabled={busy || !valid} className={btnMain}>
          {t("cn.connect")}
        </button>
      </div>
    </form>
  );
}

/** The address (and, for WooCommerce, the secret) the API shows only once when it could not register the webhooks itself. */
function ManualBox({ words, manual, onDone }: { words: Words; manual: ManualSetup; onDone: () => void }) {
  const t = makeT(words);
  return (
    <div className="flex flex-col gap-3 border-y border-line py-3" data-part="manual-setup">
      <Notice tone="brand" role="status">{t("cn.manual.title")}</Notice>
      <CopyField words={words} id="manual-address" label={t("cn.manual.address")} value={manual.address} lang="en" />
      {manual.secret ? <CopyField words={words} id="manual-secret" label={t("cn.manual.secret")} value={manual.secret} lang="en" /> : null}
      <p className="m-0 text-[14px] text-muted">{t("cn.manual.once")}</p>
      <div>
        <button type="button" className={btnQuiet} onClick={onDone}>
          {t("cn.manual.done")}
        </button>
      </div>
    </div>
  );
}

/** How orders are handled: plain labelled choices (never a sentence with blanks). */
function Choices({ conn, words, busy, onSave }: { conn: ShopConnection; words: Words; busy: boolean; onSave: (patch: Record<string, string | number | boolean>) => void }) {
  const t = makeT(words);
  const [s, setS] = React.useState(conn.settings);
  const patch: Record<string, string | number | boolean> = {};
  if (s.confirmOrders !== conn.settings.confirmOrders) patch.confirm_orders = s.confirmOrders;
  if (s.abandoned !== conn.settings.abandoned) patch.abandoned = s.abandoned;
  if (s.abandonedAfterMin !== conn.settings.abandonedAfterMin) patch.abandoned_after_min = s.abandonedAfterMin;
  if (s.checkoutConsent !== conn.settings.checkoutConsent) patch.checkout_consent = s.checkoutConsent;
  if (s.shareStatus !== conn.settings.shareStatus) patch.share_status = s.shareStatus;
  const changed = Object.keys(patch).length > 0 && s.abandonedAfterMin >= 15 && s.abandonedAfterMin <= 1440;
  return (
    <div className="flex flex-col gap-3" data-part="shop-choices">
      <SelectField id={`${conn.kind}-confirm`} label={t("cn.shop.confirm")} hint={t("cn.shop.confirm.hint")} value={s.confirmOrders} onChange={(v) => setS({ ...s, confirmOrders: v as typeof s.confirmOrders })} options={CONFIRM_ORDERS.map((o) => ({ value: o, label: t(`cn.shop.confirm.${o}`) }))} />
      <CheckField id={`${conn.kind}-consent`} label={t("cn.shop.consent")} hint={t("cn.shop.consent.hint")} checked={s.checkoutConsent} onChange={(v) => setS({ ...s, checkoutConsent: v })} />
      {conn.abandonedSupported ? (
        <>
          <CheckField id={`${conn.kind}-abandoned`} label={t("cn.shop.abandoned")} hint={t("cn.shop.abandoned.hint")} checked={s.abandoned} onChange={(v) => setS({ ...s, abandoned: v })} />
          <div className="flex flex-col">
            <label htmlFor={`${conn.kind}-wait`} className="mb-1.5 block text-sm font-semibold">
              {t("cn.shop.wait")}
            </label>
            <input id={`${conn.kind}-wait`} type="number" inputMode="numeric" min={15} max={1440} value={s.abandonedAfterMin} onChange={(e) => setS({ ...s, abandonedAfterMin: Number(e.target.value) })} className="min-h-12 w-40 rounded-lg border border-edge bg-surface px-3 text-base text-ink focus:border-brand-edge" />
            <span className="mt-1 text-[14px] text-muted">{t("cn.shop.wait.hint")}</span>
          </div>
        </>
      ) : (
        <p className="m-0 text-[14px] text-muted">{t("cn.shop.noabandoned")}</p>
      )}
      <CheckField id={`${conn.kind}-share`} label={t("cn.shop.share")} hint={t("cn.shop.share.hint")} checked={s.shareStatus} onChange={(v) => setS({ ...s, shareStatus: v })} />
      <div>
        <button type="button" disabled={busy || !changed} className={btnQuiet} onClick={() => onSave(patch)}>
          {t("cn.save.choices")}
        </button>
      </div>
    </div>
  );
}

const NOTE_WORDS = new Set(["check_currency", "price_missing", "name_missing", "availability_word_missing", "no_price_column", "variable_products_one_row", "too_many", "partial"]);

/** "Fill a list from my store": pick a Products list, look at what would be added, then save. Nothing is saved before the second step. Only the Owner may set prices. */
function Catalogue({ connection, lists, words, busy, actions }: { connection: ShopConnection; lists: ProductsList[] | null; words: Words; busy: boolean; actions: CommerceActions }) {
  const t = makeT(words);
  const r = useRunner(t);
  const [listId, setListId] = React.useState(lists?.[0]?.id ?? "");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [kept, setKept] = React.useState<CatalogueRow[]>([]);
  const off = busy || r.busy;
  if (lists === null) return <p className="m-0 text-[14px] text-muted" data-part="catalogue">{t("cn.cat.off")}</p>;
  if (lists.length === 0) return <p className="m-0 text-[14px] text-muted" data-part="catalogue">{t("cn.cat.none")}</p>;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3" data-part="catalogue">
      <h4 className="m-0 text-[15px] font-semibold text-ink">{t("cn.cat.title")}</h4>
      <p className="m-0 text-[14px] text-muted">{t("cn.cat.hint")}</p>
      {r.problem ? <Notice role="alert" tone="brand">{r.problem}</Notice> : null}
      {r.note ? <Notice role="status">{r.note}</Notice> : null}
      <SelectField id={`${connection.kind}-list`} label={t("cn.cat.list")} value={listId} onChange={(v) => { setListId(v); setPreview(null); }} options={lists.map((l) => ({ value: l.id, label: l.name }))} />
      <div>
        <button type="button" disabled={off || !listId} className={btnQuiet} onClick={() => void r.run(() => actions.previewCatalogue(connection.id, listId), (x) => { setPreview(x.preview); setKept(x.preview.rows); })}>
          {t("cn.cat.preview")}
        </button>
      </div>
      {preview ? (
        <div data-part="catalogue-preview" className="flex flex-col gap-2">
          <p className="m-0 text-[15px] text-ink">{t("cn.cat.read", { n: preview.productsRead, m: kept.length })}</p>
          {preview.notes.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {[...new Map(preview.notes.map((n) => [n.code + (n.row ?? ""), n])).values()].slice(0, 12).map((n) => (
                <li key={n.code + (n.row ?? "")}>
                  <Notice>{NOTE_WORDS.has(n.code) ? t(`cn.note.${n.code}`, { row: n.row ?? 0 }) : t("cn.note.other")}</Notice>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr>
                  {["name", "price", "stock"].map((c) => (
                    <th key={c} scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                      {t(`cn.cat.col.${c}`)}
                    </th>
                  ))}
                  <th scope="col" className="border-b border-line px-2 py-2 text-[14px] font-semibold text-muted">
                    <span className="sr-only">{t("cn.cat.keep")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row) => {
                  const price = Object.values(row.cells).find((v) => typeof v === "number" && v >= 100);
                  const stock = Object.values(row.cells).find((v) => typeof v === "string" && /stock|few|order/i.test(v));
                  const on = kept.some((k) => k.name === row.name);
                  return (
                    <tr key={row.name}>
                      <th scope="row" className="border-b border-line px-2 py-2 font-normal text-ink">
                        {row.name}
                      </th>
                      <td className="border-b border-line px-2 py-2 text-muted">{typeof price === "number" ? rupees(price) : "-"}</td>
                      <td className="border-b border-line px-2 py-2 text-muted">{typeof stock === "string" ? stock : "-"}</td>
                      <td className="border-b border-line px-2 py-2">
                        <input type="checkbox" className="size-5" aria-label={t("cn.cat.keep.row", { name: row.name })} checked={on} onChange={(e) => setKept((c) => (e.target.checked ? [...c, row] : c.filter((k) => k.name !== row.name)))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" disabled={off || kept.length === 0} className={btnQuiet} onClick={() => void r.run(() => actions.saveCatalogue(connection.id, listId, kept), (x) => { r.setNote(t("cn.cat.saved", { created: x.created, updated: x.updated })); setPreview(null); })}>
              {t("cn.cat.save")}
            </button>
          </div>
          <p className="m-0 text-[14px] text-muted">{t("cn.cat.owner")}</p>
        </div>
      ) : null}
    </div>
  );
}
