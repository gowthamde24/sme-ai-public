import type { FieldEntity, FieldKind, WorkspaceField } from "@/lib/packs/types";

import { ApiContractError, apiRequest } from "./client";
import { parseFieldDef } from "./field-def";

export { parseFieldDef };

/**
 * Custom fields of a workspace (job CL on top of job CK, ADR 0084 part 2): the definitions and the typed values on contacts and catalogue items. The contract is packages/contracts/packs.ts:
 *
 *   GET   /v1/tenants/{id}/custom-fields?entity=       every member: the definitions (active and inactive)
 *   POST  /v1/tenants/{id}/custom-fields               Owner/Admin, second factor: { entity, code, label, kind, choices?, required } (class `none`, source `owner`; 20 active per entity -> 409 custom_field_limit)
 *   PATCH /v1/tenants/{id}/custom-fields/{field_id}    Owner/Admin, second factor: { label?, required?, active?, position?, add_choices? } (a field is never deleted: made inactive; code, kind and entity never change; choices only grow)
 *   GET/PUT /v1/tenants/{id}/contacts/{contact_id}/custom   and   .../catalogue/{item_id}/custom      { values: { <code>: value } } all or nothing, null clears (422 custom_value_invalid)
 *
 * A value is a string (text, date, choice), a number, a boolean (yes_no) or a list of choice codes (multi_choice). Nothing here logs a value (a `personal` field holds a person's detail). Server side only.
 */
export type CustomValue = string | number | boolean | readonly string[] | null;
export type CustomValues = Readonly<Record<string, CustomValue>>;

export type NewField = { entity: FieldEntity; code: string; kind: FieldKind; label: string; choices?: readonly { code: string; label: string }[]; required?: boolean };

const base = (tenantId: string) => `/v1/tenants/${encodeURIComponent(tenantId)}`;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bad = (what: string): never => {
  throw new ApiContractError(`Unexpected ${what} in a custom field response.`);
};
const CODE = /^[a-z][a-z0-9_]{1,39}$/;

export async function listCustomFields(accessToken: string, tenantId: string, entity?: FieldEntity): Promise<WorkspaceField[]> {
  const json = await apiRequest(`${base(tenantId)}/custom-fields${entity ? `?entity=${entity}` : ""}`, accessToken);
  if (!isRecord(json) || !Array.isArray(json.fields) || json.fields.length > 120) return bad("list");
  return json.fields.map(parseFieldDef).sort((a, b) => a.position - b.position);
}

export function parseValues(json: unknown): CustomValues {
  if (!isRecord(json) || !Array.isArray(json.values) || json.values.length > 120) throw new ApiContractError("Unexpected body in a custom values response.");
  const out: Record<string, CustomValue> = {};
  for (const item of json.values) {
    if (!isRecord(item) || typeof item.code !== "string" || !CODE.test(item.code)) throw new ApiContractError("Unexpected code in a custom values response.");
    const v = item.value;
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[item.code] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[item.code] = v as string[];
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
    ...(input.choices ? { choices: input.choices.map((c) => ({ code: c.code, label: { en: c.label } })) } : {}),
  };
  return parseFieldDef(await apiRequest(`${base(tenantId)}/custom-fields`, accessToken, { method: "POST", body: JSON.stringify(body) }));
}

export async function setCustomFieldActive(accessToken: string, tenantId: string, fieldId: string, active: boolean): Promise<WorkspaceField> {
  return parseFieldDef(await apiRequest(`${base(tenantId)}/custom-fields/${encodeURIComponent(fieldId)}`, accessToken, { method: "PATCH", body: JSON.stringify({ active }) }));
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
