"use client";

import Link from "next/link";
import { useActionState } from "react";

import { UNITS } from "@/lib/api/products";

import type { ProductFormState } from "./actions";
import { alertBox, btnMain, fieldInput, fieldLabel, formCardWide, link, mutedText } from "@/components/v2/app/ui";
import { Rich } from "@/components/v2/app/rich";
import { makeT, type Words } from "@/components/v2/app/words";

type Action = (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;

/** One product (a saree type). The id comes from the page (one per render), so a second press is a retry. It sets no price. */
export function ProductForm({ action, tenantId, id, words }: { action: Action; tenantId: string; id: string; words?: Words; }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.ok)
    return (
      <div role="status" className={formCardWide}>
        <p>
          <Rich t={t} k="prod.added_line" vars={{ sku: state.sku ?? "" }} with={{ name: <strong>{state.name}</strong> }} />
        </p>
        <p>
          <Link href={`/app/tenants/${tenantId}/products/new`} className={link}>
            {t("prod.add_another_product")}
          </Link>
          {" · "}
          <Link href={`/app/tenants/${tenantId}?tab=products`} className={link}>
            {t("prod.see_the_products")}
          </Link>
        </p>
      </div>
    );
  return (
    <form action={formAction} className={formCardWide} aria-label={t("prod.add_a_product")}>
      <input type="hidden" name="id" value={id} />
      <label htmlFor="prod-sku" className={fieldLabel}>
        {t("prod.code")}
      </label>
      <input id="prod-sku" name="sku" required maxLength={40} pattern="[A-Za-z0-9._][A-Za-z0-9._\-]{0,39}" autoComplete="off" placeholder={t("prod.kj_red")} disabled={pending} className={fieldInput} />
      <p className={mutedText}>{t("prod.letters_digits_dot_underscore_and_hyphen")}</p>
      <label htmlFor="prod-name" className={fieldLabel}>
        {t("prod.name_the_saree_type")}
      </label>
      <input id="prod-name" name="name" required maxLength={200} disabled={pending} className={fieldInput} />
      <label htmlFor="prod-unit" className={fieldLabel}>
        {t("prod.sold_by")}
      </label>
      <select id="prod-unit" name="unit" defaultValue="piece" disabled={pending} className={fieldInput}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {t(`prod.unit.${u}`)}
          </option>
        ))}
      </select>
      <label htmlFor="prod-category" className={fieldLabel}>
        {t("prod.category_optional")}
      </label>
      <input id="prod-category" name="category" maxLength={64} disabled={pending} className={fieldInput} />
      {state?.error && (
        <p role="alert" className={alertBox}>
          {state.error}
        </p>
      )}
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("prod.saving") : t("prod.add_this_product")}
      </button>
    </form>
  );
}
