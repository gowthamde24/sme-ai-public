import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import type { ScreenMode } from "@/lib/screens/flag";

import { apiAccess, apiBusinessView, apiMe, apiOverview, apiSearch } from "./api";
import { accessJson, meJson, overviewJson, searchJson, supportViewJson } from "./staff-fixtures";
import { type AccessGrant, type Overview, type SearchResults, type StaffMe, type StaffRole, type SupportView, STAFF_ROLES, parseAccess, parseMe, parseOverview, parseSearch, parseSupportView } from "./types";

/**
 * Where the staff console's data comes from: C1's admin API (`STAFF_CONSOLE=1`) or a fixed made-up sample (`mock`, role from `?role=`). One door for the layout, the pages and the actions, with ONE way to say what went wrong, so every screen
 * draws the same plain words and never a detail. SERVER ONLY.
 */
export type Failure = "signed_out" | "no_access" | "unavailable" | "owner_ok_required" | "reason_required" | "access_required";
export type Result<T> = { ok: true; data: T } | { ok: false; failure: Failure };

/** What a refused or failed call means for the person. 401 = the staff session ended; 403 = no staff access (not_staff, second_factor_required, forbidden: never told apart on screen); 409 owner_ok_required; 422 reason_required. */
export function failureOf(error: unknown): Failure {
  if (error instanceof ApiAuthError) return "signed_out";
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return "signed_out";
    if (error.status === 403) return error.code === "access_required" ? "access_required" : "no_access";
    if (error.status === 409 && error.code === "owner_ok_required") return "owner_ok_required";
    if (error.status === 422 && error.code === "reason_required") return "reason_required";
  }
  return "unavailable";
}

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
}

/** `?role=owner|support|finance` of an address (only the mock reads it); anything else is the owner. */
export function mockRoleOf(pathAndQuery: string | null | undefined): StaffRole {
  const query = (pathAndQuery ?? "").split("?")[1] ?? "";
  const role = new URLSearchParams(query).get("role");
  return STAFF_ROLES.find((r) => r === role) ?? "owner";
}

export interface Source {
  me(): Promise<Result<StaffMe>>;
  overview(): Promise<Result<Overview>>;
  search(q: string): Promise<Result<SearchResults>>;
  access(tenantId: string, reasonCode: string, reasonText: string | null): Promise<Result<AccessGrant>>;
  view(tenantId: string, accessId: string): Promise<Result<SupportView>>;
}

export function makeSource(mode: Exclude<ScreenMode, "off">, token: string, role: StaffRole, now: () => Date = () => new Date()): Source {
  if (mode === "on") {
    return {
      me: () => attempt(() => apiMe(token)),
      overview: () => attempt(() => apiOverview(token)),
      search: (q) => attempt(() => apiSearch(token, q)),
      access: (tenantId, code, text) => attempt(() => apiAccess(token, tenantId, code, text)),
      view: (tenantId, accessId) => attempt(() => apiBusinessView(token, tenantId, accessId)),
    };
  }
  // the sample goes through the very readers the API's answers go through
  return {
    me: () => attempt(async () => parseMe(meJson(role))),
    overview: () => attempt(async () => parseOverview(overviewJson(role, now()))),
    search: (q) => attempt(async () => parseSearch(searchJson(role, q, now()))),
    access: (tenantId, code, text) =>
      attempt(async () => {
        if (code === "other" && (text ?? "").trim().length < 3) throw new ApiRequestError(422, "reason_required", "A reason is required.");
        return parseAccess(accessJson(tenantId, now()));
      }),
    view: (tenantId, accessId) =>
      attempt(async () => {
        const json = accessId.startsWith("mock-access-") ? supportViewJson(tenantId, now()) : null;
        if (!json) throw new ApiRequestError(403, "access_required", "Open the business first.");
        return parseSupportView(json);
      }),
  };
}
