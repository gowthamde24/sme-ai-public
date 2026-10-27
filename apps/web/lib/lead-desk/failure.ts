import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { REFUSED_REASONS, type Failure, type RefusedReason } from "./imports/types";

/**
 * What a refusal from the API becomes for the Lead Desk screens (night 4): ONE closed word the screen has a sentence for. The API's own text is never shown; a code the screen does not know is "down" (try again).
 * A rejected session is re-thrown, so the action sends the person to the sign-in page. Contract: contract-lead-sources.md ("Errors").
 */
export function leadFailure(error: unknown): Failure {
  if (error instanceof ApiAuthError) throw error;
  if (!(error instanceof ApiRequestError)) return { ok: false, error: "down" };
  const { status, code } = error;
  if (code === "real_data_gate" || error.reason === "real_data_gate") return { ok: false, error: "real_data_gate" };
  if (status === 403) {
    if (code === "mfa_required") return { ok: false, error: "mfa" };
    if (code === "workspace_read_only") return { ok: false, error: "read_only" };
    return { ok: false, error: "forbidden" };
  }
  if (status === 409 && code === "import_id_used") return { ok: false, error: "import_id_used" };
  if (status === 413) return { ok: false, error: "too_large" };
  if (status === 429) return { ok: false, error: "rate_limited" };
  if (status === 422) {
    if (code === "sheet_refused") {
      const reason = (REFUSED_REASONS as readonly string[]).includes(error.reason ?? "") ? (error.reason as RefusedReason) : "unreadable";
      return { ok: false, error: "sheet_refused", reason };
    }
    if (code === "sheet_not_public" || code === "sheet_link_invalid" || code === "mapping_required_missing") return { ok: false, error: code };
    return { ok: false, error: "invalid" };
  }
  if (status === 502 && code === "sheet_unreachable") return { ok: false, error: "sheet_unreachable" };
  if (status === 503 && code === "connector_not_available") return { ok: false, error: "connector_not_available" };
  if (status === 503 && code === "lead_sources_unavailable") return { ok: false, error: "not_available" };
  if (status === 404) return { ok: false, error: "not_available" };
  return { ok: false, error: "down" };
}
