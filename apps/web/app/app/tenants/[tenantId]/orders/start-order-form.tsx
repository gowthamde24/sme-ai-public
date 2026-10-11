"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ActionResultV2 } from "@/components/v2/app/parts";
import { makeT, type Words } from "@/components/v2/app/words";
import { btnMain, formCol, link, mutedText, noteBox } from "@/components/v2/app/ui";
import type { OrderActionState } from "./order-actions";

type Action = (prev: OrderActionState, formData: FormData) => Promise<OrderActionState>;

/**
 * "Start order" on an APPROVED quote. An owner or an admin with their authenticator app starts it; the order copies the quote's figures (nothing is typed here) and is a record
 * a person keeps up to date. Starting an order sends nothing to anyone.
 */
export function StartOrderForm({ start, orderId, role, secondFactorMissing, words }: { start: Action; orderId: string; role: string; secondFactorMissing: boolean; words?: Words }) {
  const t = makeT(words);
  const [state, formAction, pending] = useActionState(start, undefined);
  if (role !== "owner" && role !== "admin") return <p className={mutedText}>{t("orders.an_owner_or_admin_starts_an")}</p>;
  if (secondFactorMissing)
    return (
      <p role="note" className={noteBox}>
        {t("orders.mfa_start_a")} <Link href="/app/security" className={link}>{t("orders.set_it_up_on_the_security")}</Link>{t("orders.mfa_b")}
      </p>
    );
  return (
    <form action={formAction} className={formCol}>
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" className={btnMain} disabled={pending}>
        {pending ? t("orders.starting") : t("orders.start_order")}
      </button>
      <p className={mutedText}>{t("orders.the_order_copies_this_quote_s")}</p>
      <ActionResultV2 state={state} />
    </form>
  );
}
