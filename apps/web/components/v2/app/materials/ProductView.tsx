import Link from "next/link";

import type { MaterialItemOut } from "@contracts";

import { FreshPhotos } from "../catalogue/FreshPhotos";
import { Gallery } from "../catalogue/Gallery";
import { areaText, groupIndian, percentFromBps } from "@/lib/money";
import type { CustomValues } from "@/lib/api/custom-fields";
import type { FormField } from "@/lib/packs/form-fields";
import { say, type TodayWords } from "../today/today-words";
import type { Role } from "../today/types";
import { badge, card, okLine, primary } from "../visits/styles";
import { badgesOf, missingFor, perUnit, quotable, unitWord } from "./mat-logic";

const BADGE_TONE = { inactive: "bg-surface-2 text-ink border border-edge", few_left: "bg-amber-bg text-amber-text", made_to_order: "bg-info-bg text-info-text" } as const;

/** A custom value as text: a choice by its label, yes or no in words, a list joined, a number as it is. */
export function valueText(f: FormField, v: CustomValues[string] | undefined, words: TodayWords): string | null {
  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
  if (typeof v === "boolean") return say(words, v ? "fields.form.yes" : "fields.form.no");
  if (Array.isArray(v)) return v.map((c) => f.choices?.find((x) => x.code === c)?.label ?? c).join(", ");
  if (f.choices && typeof v === "string") return f.choices.find((x) => x.code === v)?.label ?? v;
  return String(v);
}

export type ProductViewProps = {
  base: string;
  item: MaterialItemOut;
  role: Role;
  words: TodayWords;
  fields: readonly FormField[];
  custom: CustomValues;
  saved: boolean;
};

/**
 * One product (job CO): the photos, the unit it is sold in and its price, what a quote needs from it (the figures the owner entered: price, GST rate, pieces per area, pieces per pallet, minimum order, lead days) and the
 * extra details of the business type. A product that cannot be quoted yet says what is missing, in words; nothing is assumed. Owner and Admin can change it.
 */
export function ProductView({ base, item, role, words, fields, custom, saved }: ProductViewProps) {
  const admin = role === "owner" || role === "admin";
  const inputs = item.inputs;
  const missing = missingFor(inputs, item.area_unit !== null);
  const areaLabel = item.area_unit ? unitWord(words, item.area_unit) : "";
  const rows: [string, string | null][] = [
    ["mat.in.price", item.price_text],
    ["mat.in.gst", inputs.gst_bps === null ? null : `${percentFromBps(inputs.gst_bps)}%`],
    ["mat.in.hsn", inputs.hsn],
    ["mat.in.ppa", inputs.pieces_per_area_x1000 === null ? null : `${areaText(inputs.pieces_per_area_x1000 / 10)}${areaLabel ? ` / ${areaLabel}` : ""}`],
    ["mat.in.pallet", inputs.pieces_per_pallet === null ? null : groupIndian(inputs.pieces_per_pallet)],
    ["mat.in.min", inputs.min_order_qty === null ? null : `${groupIndian(inputs.min_order_qty)} ${unitWord(words, item.sell_unit)}`],
    ["mat.in.lead", inputs.lead_days === null ? null : say(words, "mat.in.days", { n: inputs.lead_days })],
  ];
  const specs = fields.map((f) => [f.label, valueText(f, custom[f.code], words)] as const).filter((r): r is readonly [string, string] => r[1] !== null);
  return (
    <FreshPhotos seconds={item.photos.length ? Math.min(...item.photos.map((p) => p.expires_in_seconds)) : null}>
      <div data-screen="product" className="flex flex-col gap-5">
        <p>
          <Link href={`${base}/materials`} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-text hover:underline">
            ← {say(words, "nav.item.sarees")}
          </Link>
        </p>
        {saved ? (
          <p role="status" className={okLine}>
            {say(words, "mat.product.saved")}
          </p>
        ) : null}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-[26px] font-semibold leading-[1.15] [overflow-wrap:anywhere] md:text-4xl">{item.name}</h1>
            <p className="text-base text-muted">{perUnit(words, item.sell_unit)}</p>
            <p className="flex flex-wrap gap-1.5">
              {badgesOf(item).map((b) => (
                <span key={b} data-badge={b} className={`${badge} ${BADGE_TONE[b]}`}>
                  {say(words, b === "inactive" ? "catalogue.badge.inactive" : `catalogue.stock.${b}`)}
                </span>
              ))}
            </p>
          </div>
          {admin ? (
            <Link href={`${base}/materials/${item.id}/edit`} className={primary}>
              {say(words, "mat.product.edit")}
            </Link>
          ) : null}
        </header>
        <div className="grid gap-5 md:grid-cols-2">
          <Gallery photos={item.photos} name={item.name} words={words} />
          <div className="flex flex-col gap-4">
            <section aria-labelledby="mat-inputs" className={card} data-part="inputs">
              <h2 id="mat-inputs" className="font-display text-xl font-bold">
                {say(words, "mat.in.title")}
              </h2>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base">
                {rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-sm font-semibold text-muted">{say(words, k)}</dt>
                    <dd className={v === null ? "text-muted" : "font-medium"}>{v ?? say(words, "mat.in.notset")}</dd>
                  </div>
                ))}
              </dl>
              {quotable(item) ? (
                <p data-state="ready" className="text-sm font-semibold text-green-text">
                  {say(words, "mat.in.ready")}
                </p>
              ) : (
                <div data-state="missing" role="note" className="rounded-lg border border-amber-text bg-amber-bg p-3 text-sm font-medium text-amber-text">
                  <p>{say(words, "mat.in.missing")}</p>
                  <ul className="mt-1 list-inside list-disc">
                    {missing.map((c) => (
                      <li key={c}>{say(words, `mat.missing.${c}`)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {admin ? <p className="text-sm text-muted">{say(words, "mat.in.hint")}</p> : null}
            </section>
            {specs.length > 0 ? (
              <section aria-labelledby="mat-specs" className={card} data-part="specs">
                <h2 id="mat-specs" className="font-display text-xl font-bold">
                  {say(words, "mat.specs.title")}
                </h2>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-base">
                  {specs.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-sm font-semibold text-muted">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </FreshPhotos>
  );
}
