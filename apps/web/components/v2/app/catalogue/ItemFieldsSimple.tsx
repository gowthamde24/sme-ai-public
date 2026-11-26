"use client";

import { ChevronDown } from "lucide-react";

import { COLOURS, FABRICS, MAX_BORDER, MAX_COLOURS, MAX_NAME, MAX_OCCASIONS, OCCASIONS, PRICE_BANDS, STOCK_STATUSES, ZARIS, type Colour, type Fabric, type Item, type Occasion, type PriceBand, type StockStatus, type Zari } from "@/lib/api/catalogue";
import type { FormField } from "@/lib/packs/form-fields";

import { CustomFieldsInputs, type FieldValues } from "../fields/CustomFieldsInputs";
import { Tick } from "../ds/Tick";
import { EffectLine, MoreBox, pgCard } from "../jobs/pages/parts";
import { Choose, Sentence } from "../jobs/rules/parts";
import { say, type TodayWords } from "../today/today-words";
import { field, help, label } from "../visits/styles";
import { vocab } from "./ItemCard";
import { bandText } from "./catalogue-logic";

/** What the form of the saree holds (it lives in the editor; this part only draws it and says every change). */
export type ItemFormValues = {
  words: TodayWords;
  busy: boolean;
  owner: boolean;
  item: Item | null;
  name: string;
  fabric: Fabric;
  colours: readonly Colour[];
  zari: Zari;
  border: string;
  occasions: readonly Occasion[];
  band: PriceBand;
  stock: StockStatus;
  fields?: readonly FormField[];
  custom: FieldValues;
  priceText: string;
  clearPrice: boolean;
  /** the saree will be shown to customers when it is saved */
  shown: boolean;
};
export type ItemFormSetters = {
  setName: (v: string) => void;
  setFabric: (v: Fabric) => void;
  setColours: (f: (cur: Colour[]) => Colour[]) => void;
  setZari: (v: Zari) => void;
  setBorder: (v: string) => void;
  setOccasions: (f: (cur: Occasion[]) => Occasion[]) => void;
  setBand: (v: PriceBand) => void;
  setStock: (v: StockStatus) => void;
  setCustom: (v: FieldValues) => void;
  setPriceText: (v: string) => void;
  setClearPrice: (v: boolean) => void;
};

/**
 * The add or change form of a saree under JOBS (the simplicity pass): the name, then ONE sentence with the choices inside it ("A [Kanchi pattu] saree, about [₹10,000 to ₹25,000].") and the colours, with one live line that says what customers will see.
 * The zari, the border, the occasions, how many are in stock, the exact price (the Owner's, with its own help line) and the business type's extra fields are under "More choices" on the same page. Every field of before is here, with the same limits
 * (a name up to 120 letters, 1 to 4 colours, up to 4 occasions, a border up to 120 letters) and the same values; the editor still does the saving, in the same order, with the same refusals.
 */
export function ItemFieldsSimple(p: ItemFormValues & ItemFormSetters) {
  const { words, busy } = p;
  const t = (k: string, v?: Record<string, string | number>) => say(words, k, v);
  const fabricName = (f: string) => vocab(words, "fabric", f, f);
  const colourNames = p.colours.map((c) => vocab(words, "colour", c, c)).join(", ");
  const nameShown = p.name.trim() || t("jobs.pg.item.noname");
  return (
    <div className="flex flex-col gap-4" data-part="item-fields" data-simple="">
      <section className={`${pgCard} flex flex-col gap-3`} aria-label={t("jobs.pg.item.card")}>
        <div>
          <label htmlFor="cat-name" className={label}>
            {t("catalogue.field.name")}
          </label>
          <input id="cat-name" value={p.name} maxLength={MAX_NAME} disabled={busy} onChange={(e) => p.setName(e.target.value)} aria-describedby="cat-name-help" className={`${field} write-ctl`} />
          <p id="cat-name-help" className={help}>
            {t("catalogue.form.name.help")}
          </p>
        </div>
        <Sentence
          line="item"
          template={t("jobs.pg.item.line")}
          parts={{
            fabric: () => <Choose aria={t("catalogue.field.fabric")} value={p.fabric} options={FABRICS} text={fabricName} disabled={busy} onChange={(v) => p.setFabric(v as Fabric)} />,
            band: () => <Choose aria={t("catalogue.field.price_band")} value={p.band} options={PRICE_BANDS} text={(b) => bandText(p.words, b as PriceBand)} disabled={busy} onChange={(v) => p.setBand(v as PriceBand)} />,
          }}
        />
        <details data-part="colours" open={p.colours.length === 0} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 text-[16px] text-ink [&::-webkit-details-marker]:hidden">
            <span>{t("jobs.pg.item.colours")}</span>
            <b className="inline-flex items-center gap-1.5 rounded-md bg-brand-bg py-1 pl-3.5 pr-2.5 text-[16px] font-semibold text-brand-text">
              {colourNames || t("jobs.pg.item.colours.none")}
              <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
            </b>
          </summary>
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 pt-2">
            <legend className="sr-only">{t("catalogue.field.colours")}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-0">
              {COLOURS.map((c) => (
                <Tick key={c} label={vocab(words, "colour", c, c)} checked={p.colours.includes(c)} disabled={busy || (!p.colours.includes(c) && p.colours.length >= MAX_COLOURS)} onChange={(e) => p.setColours((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />
              ))}
            </div>
            <p className={help}>{t("catalogue.form.colours.help")}</p>
          </fieldset>
        </details>
        <EffectLine part="item-effect" label={t("jobs.pg.item.effect.label")} text={p.shown ? t("jobs.pg.item.effect.shown", { name: nameShown, fabric: fabricName(p.fabric), band: bandText(p.words, p.band) }) : t("jobs.pg.item.effect.hidden", { name: nameShown })} />
      </section>
      <MoreBox title={t("jobs.pg.more")} sub={t("jobs.pg.item.more.sub")}>
        <Sentence line="zari" template={t("jobs.pg.item.zari")} parts={{ zari: () => <Choose aria={t("catalogue.field.zari")} value={p.zari} options={ZARIS} text={(z) => t(`catalogue.zari.${z}`)} disabled={busy} onChange={(v) => p.setZari(v as Zari)} /> }} />
        <Sentence line="stock" template={t("jobs.pg.item.stock")} parts={{ stock: () => <Choose aria={t("catalogue.field.stock")} value={p.stock} options={STOCK_STATUSES} text={(s) => t(`catalogue.stock.${s}`)} disabled={busy} onChange={(v) => p.setStock(v as StockStatus)} /> }} />
        <div>
          <label htmlFor="cat-border" className={label}>
            {t("catalogue.field.border")}
          </label>
          <input id="cat-border" value={p.border} maxLength={MAX_BORDER} disabled={busy} onChange={(e) => p.setBorder(e.target.value)} aria-describedby="cat-border-help" className={`${field} write-ctl`} />
          <p id="cat-border-help" className={help}>
            {t("catalogue.form.border.help")}
          </p>
        </div>
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{t("catalogue.field.occasions")}</legend>
          <div className="flex flex-wrap gap-x-4">
            {OCCASIONS.map((o) => (
              <Tick key={o} label={vocab(words, "occasion", o, o)} checked={p.occasions.includes(o)} disabled={busy || (!p.occasions.includes(o) && p.occasions.length >= MAX_OCCASIONS)} onChange={(e) => p.setOccasions((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))} />
            ))}
          </div>
          <p className={help}>{t("catalogue.form.occasions.help")}</p>
        </fieldset>
        {p.fields && p.fields.length > 0 ? <CustomFieldsInputs fields={p.fields} values={p.custom} onChange={p.setCustom} words={{ title: t("fields.form.title"), yes: t("fields.form.yes"), no: t("fields.form.no"), pick: t("fields.form.pick") }} idPrefix="cat-cf" disabled={busy} /> : null}
        <div data-part="exact-price" className="rounded-xl border border-line p-3.5">
          {p.owner ? (
            <>
              <label htmlFor="cat-price" className={label}>
                {t("catalogue.field.price")} (₹)
              </label>
              <input id="cat-price" inputMode="decimal" autoComplete="off" value={p.priceText} disabled={busy || p.clearPrice} onChange={(e) => p.setPriceText(e.target.value)} aria-describedby="cat-price-help" className={`${field} write-ctl max-w-60`} />
              <p id="cat-price-help" className={help}>
                {t("catalogue.form.price.owner")}
              </p>
              {p.item?.price_text ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="m-0 text-base font-semibold">{t("catalogue.form.price.now", { price: p.item.price_text })}</p>
                  <Tick label={t("catalogue.form.price.clear")} checked={p.clearPrice} disabled={busy} onChange={(e) => p.setClearPrice(e.target.checked)} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="m-0 text-sm font-semibold">{t("catalogue.field.price")}</p>
              <p className="m-0 mt-1 text-base">{p.item?.price_text ?? t("catalogue.field.none")}</p>
              <p className={help}>{t("catalogue.form.price.other")}</p>
            </>
          )}
        </div>
      </MoreBox>
    </div>
  );
}
