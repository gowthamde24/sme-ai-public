"use client";

import Link from "next/link";
import { useActionState } from "react";

import { ActionResult } from "../enquiries/action-result";
import type { OrderActionState } from "./order-actions";

type Action = (prev: OrderActionState, formData: FormData) => Promise<OrderActionState>;

/**
 * "Start order" on an APPROVED quote. An owner or an admin with their authenticator app starts it; the order copies the quote's figures (nothing is typed here) and is a record
 * a person keeps up to date. Starting an order sends nothing to anyone.
 */
export function StartOrderForm({ start, orderId, role, secondFactorMissing }: { start: Action; orderId: string; role: string; secondFactorMissing: boolean }) {
  const [state, formAction, pending] = useActionState(start, undefined);
  if (role !== "owner" && role !== "admin") return <p className="hint">An owner or admin starts an order from an approved quote.</p>;
  if (secondFactorMissing)
    return (
      <p role="note">
        Starting an order needs your authenticator app. <Link href="/app/security" className="tap">Set it up on the Security page</Link>, then sign in again with its code.
      </p>
    );
  return (
    <form action={formAction}>
      <input type="hidden" name="order_id" value={orderId} />
      <button type="submit" disabled={pending}>
        {pending ? "Starting..." : "Start order"}
      </button>
      <p className="hint">The order copies this quote&apos;s total and advance. It is a record you keep up to date: nothing is sent to anyone.</p>
      <ActionResult state={state} />
    </form>
  );
}
