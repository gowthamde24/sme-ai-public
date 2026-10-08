import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side call of OUR API that adds one product (a saree type) to the catalog (Owner or Admin; no second factor). The code follows the price-list file's own rule so that every product can be on a
 * price list later. Idempotent on `id`: an identical retry is a replay (200).
 */
export const UNITS = ["piece", "set"] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABELS: Record<Unit, string> = { piece: "Piece", set: "Set" };

/** Letters, digits, dot, underscore, hyphen; at most 40; not starting with = + - @ (the price-list file refuses those). */
export const SKU_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,39}$/;
export const MAX_NAME = 200;
export const MAX_CATEGORY = 64;

export type ProductInput = { id: string; sku: string; name: string; unit: Unit; category: string | null };

export async function createProduct(accessToken: string, tenantId: string, input: ProductInput): Promise<string> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(input.id)) throw new ApiContractError("id");
  const body = { id: input.id, sku: input.sku, name: input.name, unit: input.unit, ...(input.category !== null && { category: input.category }) };
  const json = await apiRequest(`/v1/tenants/${tenantId}/products`, accessToken, { method: "POST", body: JSON.stringify(body) });
  const id = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>).id : undefined;
  if (typeof id !== "string" || !isCanonicalUuid(id)) throw new ApiContractError("Unexpected product in a response.");
  return id;
}
