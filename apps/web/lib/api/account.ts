import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * What a new account still has to do after sign-up, and the first-login setup itself (job AD / D2). Server side only, with the signed-in
 * user's own token. The business name is never sent from here: the database takes it from the sign-up.
 */
export const BUSINESS_TYPES = ["textiles", "construction", "other"] as const;
export const SETUP_LANGUAGES = ["en", "te", "hi", "kn"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export type SetupLanguage = (typeof SETUP_LANGUAGES)[number];

/** `needed`: confirmed, terms accepted, no business yet. `done`: the business exists (tenantId). `none`: nothing to do (an invited person). */
export interface AccountSetup {
  state: "none" | "needed" | "done";
  tenantId: string | null;
  businessName: string | null;
}

export interface SetupResult {
  tenantId: string;
  /** false for a repeat (a double click or a second tab): the same business came back and nothing new was made */
  created: boolean;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an account setup response.`);
}

export function parseAccountSetup(json: unknown): AccountSetup {
  if (!isRecord(json)) return bad("body");
  const { state, tenant_id: tenantId, business_name: businessName } = json;
  if (state !== "none" && state !== "needed" && state !== "done") return bad("state");
  if (tenantId !== null && !(typeof tenantId === "string" && isCanonicalUuid(tenantId))) return bad("tenant_id");
  if (businessName !== null && typeof businessName !== "string") return bad("business_name");
  if (state === "done" && tenantId === null) return bad("tenant_id");
  return { state, tenantId, businessName };
}

export function parseSetupResult(json: unknown): SetupResult {
  if (!isRecord(json)) return bad("body");
  const { tenant_id: tenantId, created } = json;
  if (typeof tenantId !== "string" || !isCanonicalUuid(tenantId)) return bad("tenant_id");
  if (typeof created !== "boolean") return bad("created");
  return { tenantId, created };
}

/** `GET /v1/account/setup`: what this account still has to do. */
export async function fetchAccountSetup(accessToken: string): Promise<AccountSetup> {
  return parseAccountSetup(await apiRequest("/v1/account/setup", accessToken));
}

/** `POST /v1/account/setup`: make the account's one business (once). Two choices only. */
export async function submitAccountSetup(
  accessToken: string,
  choices: { businessType: BusinessType; language: SetupLanguage },
): Promise<SetupResult> {
  return parseSetupResult(
    await apiRequest("/v1/account/setup", accessToken, {
      method: "POST",
      body: JSON.stringify({ business_type: choices.businessType, language: choices.language }),
    }),
  );
}
