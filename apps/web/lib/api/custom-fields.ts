import type { FieldEntity, FieldKind, PiiClass, WorkspaceField } from "@/lib/packs/types";

import { ApiContractError, apiRequest } from "./client";
import { parseField } from "./pack";

/**
 * Custom fields of a workspace (job CL; ADR 0084 part 2): the definitions and the typed values on contacts and catalogue items. The contract is the sketch of ADR 0084 (job CK builds it):
 *
 *   POST  /v1/tenants/{id}/custom-fields            { entity, code, kind, label, choices?, required } -> the field   (Owner/Admin, second factor)
 *   PATCH /v1/tenants/{id}/custom-fields/{field_id} { label?, active?, add_choices? }                  -> the field   (a field is never deleted: made inactive)
 *   PUT   /v1/tenants/{id}/contacts/{contact_id}/custom   { values: { <code>: value } } -> { values }
 *   PUT   /v1/tenants/{id}/catalogue/{item_id}/custom     { values: { <code>: value } } -> { values }
 *   GET   the same two paths -> { values }
 * The definitions of the pack arrive with `GET .../pack` (lib/api/pack.ts). Until the routes exist the calls answer 404 and the screens say "Not available yet" (they never pretend a value was saved). A value is a
 * string (text, date, choice), a number, a boolean (yes_no) or a list of choice codes (multi_choice). A personal or child field is never put in a log by this code: nothing here logs a value.
 */
export type CustomValue = string | number | boolean | readonly string[] | null;
export type CustomValues = Readonly<Record<string, CustomValue>>;

export type NewField = { entity: FieldEntity; code: string; kind: FieldKind; label: string; choices?: readonly { code: string; label: string }[]; required?: boolean; pii_class?: PiiClass };

const base = (tenantId: string) => `/v1/tenants/${encodeURIComponent(tenantId)}`;

export function parseValues(json: unknown): CustomValues {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ApiContractError("Unexpected body in a custom values response.");
  const raw = (json as Record<string, unknown>).values;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ApiContractError("Unexpected values in a custom values response.");
  const out: Record<string, CustomValue> = {};
  for (const [code, v] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) throw new ApiContractError("Unexpected code in a custom values response.");
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[code] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[code] = v as string[];
    else throw new ApiContractError("Unexpected value in a custom values response.");
  }
  return out;
}

export async function createCustomField(accessToken: string, tenantId: string, input: NewField): Promise<WorkspaceField> {
  const body = {
    entity: input.entity,
    code: input.code,
    kind: input.kind,
    label: { en: input.label },
    required: input.required === true,
    pii_class: input.pii_class ?? "none",
    ...(input.choices ? { choices: input.choices.map((c) => ({ code: c.code, label: { en: c.label } })) } : {}),
  };
  return parseField(await apiRequest(`${base(tenantId)}/custom-fields`, accessToken, { method: "POST", body: JSON.stringify(body) }));
}

export async function setCustomFieldActive(accessToken: string, tenantId: string, fieldId: string, active: boolean): Promise<WorkspaceField> {
  return parseField(await apiRequest(`${base(tenantId)}/custom-fields/${encodeURIComponent(fieldId)}`, accessToken, { method: "PATCH", body: JSON.stringify({ active }) }));
}

export async function getContactCustom(accessToken: string, tenantId: string, contactId: string): Promise<CustomValues> {
  return parseValues(await apiRequest(`${base(tenantId)}/contacts/${encodeURIComponent(contactId)}/custom`, accessToken));
}
export async function putContactCustom(accessToken: string, tenantId: string, contactId: string, values: CustomValues): Promise<CustomValues> {
  return parseValues(await apiRequest(`${base(tenantId)}/contacts/${encodeURIComponent(contactId)}/custom`, accessToken, { method: "PUT", body: JSON.stringify({ values }) }));
}
export async function getCatalogueCustom(accessToken: string, tenantId: string, itemId: string): Promise<CustomValues> {
  return parseValues(await apiRequest(`${base(tenantId)}/catalogue/${encodeURIComponent(itemId)}/custom`, accessToken));
}
export async function putCatalogueCustom(accessToken: string, tenantId: string, itemId: string, values: CustomValues): Promise<CustomValues> {
  return parseValues(await apiRequest(`${base(tenantId)}/catalogue/${encodeURIComponent(itemId)}/custom`, accessToken, { method: "PUT", body: JSON.stringify({ values }) }));
}
