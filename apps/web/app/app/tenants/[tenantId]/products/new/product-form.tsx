"use client";

import Link from "next/link";
import { useActionState } from "react";

import { UNITS, UNIT_LABELS } from "@/lib/api/products";

import type { ProductFormState } from "./actions";

type Action = (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;

/** One product (a saree type). The id comes from the page (one per render), so a second press is a retry. It sets no price. */
export function ProductForm({ action, tenantId, id }: { action: Action; tenantId: string; id: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.ok)
    return (
      <div role="status" className="card" style={{ maxWidth: "40rem" }}>
        <p>
          <strong>Added {state.name}</strong> (code {state.sku}).
        </p>
        <p>
          <Link href={`/app/tenants/${tenantId}/products/new`} className="tap">
            Add another product
          </Link>
          {" · "}
          <Link href={`/app/tenants/${tenantId}?tab=products`} className="tap">
            See the products
          </Link>
        </p>
      </div>
    );
  return (
    <form action={formAction} className="card" style={{ maxWidth: "40rem" }} aria-label="Add a product">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="prod-sku">Code</label>
      <input id="prod-sku" name="sku" required maxLength={40} pattern="[A-Za-z0-9._][A-Za-z0-9._\-]{0,39}" autoComplete="off" placeholder="KJ-RED" disabled={pending} />
      <p className="hint">Letters, digits, dot, underscore and hyphen only, 40 at most. This is the code the price-list file uses.</p>
      <label htmlFor="prod-name">Name (the saree type)</label>
      <input id="prod-name" name="name" required maxLength={200} disabled={pending} />
      <label htmlFor="prod-unit">Sold by</label>
      <select id="prod-unit" name="unit" defaultValue="piece" disabled={pending}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))}
      </select>
      <label htmlFor="prod-category">Category (optional)</label>
      <input id="prod-category" name="category" maxLength={64} disabled={pending} />
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Add this product"}
      </button>
    </form>
  );
}
