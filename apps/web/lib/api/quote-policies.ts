import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * The quote policy client: the published versions (Owner or Admin) and the publishing of a new one (Owner or Admin with a second factor). Server side only, with the signed-in user's own token.
 *
 * Every response is parsed strictly: a wrong type, a missing key, a malformed id or date, or a number outside the limits of the database is a contract error and nothing is shown. The request body
 * is the policy and nothing else: the shipping fields are FIXED at zero here (the shop charges no courier), and `tax_mode`, `rounding_mode`, `shipping_free_above_paise` and `required_inputs` are
 * never sent (the database fills them). There is no GST rate, price range or last-price threshold in it: those need a later database change.
 */

/** The limits of `public.create_quote_policy_version` (the same as the API's request model). */
export const POLICY_LIMITS = {
  discountCeilingBps: { min: 0, max: 10_000 },
  validityDays: { min: 1, max: 365 },
  advanceBps: { min: 0, max: 10_000 },
  netDays: { min: 0, max: 180 },
  repeatCreditLimitPaise: { min: 0, max: 1_000_000_000 },
  shippingFeePaise: { min: 0, max: 100_000_000 },
  shippingTaxBps: { min: 0, max: 10_000 },
} as const;

export interface QuotePolicyVersion {
  id: string;
  version_no: number;
  effective_from: string;
  discount_ceiling_bps: number;
  shipping_flat_fee_paise: number;
  shipping_free_above_paise: number | null;
  shipping_tax_bps: number;
  validity_days: number;
  new_advance_bps: number;
  repeat_advance_bps: number;
  net_days: number;
  tax_mode: string;
  rounding_mode: string;
  repeat_credit_limit_paise: number;
  seller_state: string;
  required_inputs: string[];
  created_at: string;
  in_force: boolean;
}

export interface QuotePolicyResult {
  version_id: string;
  version_no: number;
  effective_from: string;
  replayed: boolean;
}

/** What the page sends: every number already converted exactly (basis points, paise). The shipping fields are not part of the input: they are fixed at zero when the body is built. */
export interface QuotePolicyInput {
  id: string;
  effectiveFrom: string;
  discountCeilingBps: number;
  validityDays: number;
  newAdvanceBps: number;
  repeatAdvanceBps: number;
  netDays: number;
  repeatCreditLimitPaise: number;
  sellerState: string;
}

// ----------------------------------------------------------------------------- strict parsing
type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a quote policy response.`);
}
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATE = /^[A-Z]{2}$/;
const rec = (v: unknown, what: string): Rec => (isRecord(v) ? v : bad(what));
const str = (r: Rec, k: string): string => (typeof r[k] === "string" ? (r[k] as string) : bad(k));
const bool = (r: Rec, k: string): boolean => (typeof r[k] === "boolean" ? (r[k] as boolean) : bad(k));
const uuid = (r: Rec, k: string): string => {
  const v = str(r, k);
  return isCanonicalUuid(v) ? v : bad(k);
};
function date(r: Rec, k: string): string {
  const v = str(r, k);
  const m = DAY.exec(v);
  if (!m) return bad(k);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? v : bad(k);
}
function int(r: Rec, k: string, min: number, max: number): number {
  const v = r[k];
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : bad(k);
}
function instant(r: Rec, k: string): string {
  const v = str(r, k);
  return v !== "" && !Number.isNaN(Date.parse(v)) ? v : bad(k);
}

export function parseQuotePolicyVersion(json: unknown): QuotePolicyVersion {
  const r = rec(json, "policy version");
  const L = POLICY_LIMITS;
  const state = str(r, "seller_state");
  if (!STATE.test(state)) bad("seller_state");
  if (!Array.isArray(r.required_inputs) || r.required_inputs.some((x) => typeof x !== "string")) bad("required_inputs");
  return {
    id: uuid(r, "id"),
    version_no: int(r, "version_no", 1, Number.MAX_SAFE_INTEGER),
    effective_from: date(r, "effective_from"),
    discount_ceiling_bps: int(r, "discount_ceiling_bps", L.discountCeilingBps.min, L.discountCeilingBps.max),
    shipping_flat_fee_paise: int(r, "shipping_flat_fee_paise", L.shippingFeePaise.min, L.shippingFeePaise.max),
    shipping_free_above_paise: r.shipping_free_above_paise === null ? null : int(r, "shipping_free_above_paise", L.shippingFeePaise.min, L.shippingFeePaise.max),
    shipping_tax_bps: int(r, "shipping_tax_bps", L.shippingTaxBps.min, L.shippingTaxBps.max),
    validity_days: int(r, "validity_days", L.validityDays.min, L.validityDays.max),
    new_advance_bps: int(r, "new_advance_bps", L.advanceBps.min, L.advanceBps.max),
    repeat_advance_bps: int(r, "repeat_advance_bps", L.advanceBps.min, L.advanceBps.max),
    net_days: int(r, "net_days", L.netDays.min, L.netDays.max),
    tax_mode: str(r, "tax_mode"),
    rounding_mode: str(r, "rounding_mode"),
    repeat_credit_limit_paise: int(r, "repeat_credit_limit_paise", L.repeatCreditLimitPaise.min, L.repeatCreditLimitPaise.max),
    seller_state: state,
    required_inputs: r.required_inputs as string[],
    created_at: instant(r, "created_at"),
    in_force: bool(r, "in_force"),
  };
}

export function parseQuotePolicyVersions(json: unknown): QuotePolicyVersion[] {
  if (!Array.isArray(json)) return bad("policy versions");
  return json.map(parseQuotePolicyVersion);
}

export function parseQuotePolicyResult(json: unknown): QuotePolicyResult {
  const r = rec(json, "policy result");
  return { version_id: uuid(r, "version_id"), version_no: int(r, "version_no", 1, Number.MAX_SAFE_INTEGER), effective_from: date(r, "effective_from"), replayed: bool(r, "replayed") };
}

// ----------------------------------------------------------------------------- requests
const base = (tenantId: string) => `/v1/tenants/${tenantId}/quote-policy-versions`;

function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}

/** Every published version, newest first, with the one in force today marked (Owner or Admin). */
export async function fetchQuotePolicyVersions(accessToken: string, tenantId: string): Promise<QuotePolicyVersion[]> {
  checked(tenantId);
  return parseQuotePolicyVersions(await apiRequest(base(tenantId), accessToken));
}

/** The body: the typed policy fields, the shipping fixed at zero, and nothing else (no tax mode, rounding mode, free-shipping threshold or required inputs: the database fills those). */
export function policyBody(input: QuotePolicyInput): Record<string, unknown> {
  return {
    id: input.id,
    effective_from: input.effectiveFrom,
    discount_ceiling_bps: input.discountCeilingBps,
    shipping_flat_fee_paise: 0,
    shipping_tax_bps: 0,
    validity_days: input.validityDays,
    new_advance_bps: input.newAdvanceBps,
    repeat_advance_bps: input.repeatAdvanceBps,
    net_days: input.netDays,
    repeat_credit_limit_paise: input.repeatCreditLimitPaise,
    seller_state: input.sellerState,
  };
}

/** An Owner or Admin (with a second factor) publishes a new version. The same id with the same content is a replay, never a second version. */
export async function createQuotePolicyVersion(accessToken: string, tenantId: string, input: QuotePolicyInput): Promise<QuotePolicyResult> {
  checked(tenantId, input.id);
  return parseQuotePolicyResult(await apiRequest(base(tenantId), accessToken, { method: "POST", body: JSON.stringify(policyBody(input)) }));
}
