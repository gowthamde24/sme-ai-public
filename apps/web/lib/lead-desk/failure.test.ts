import { describe, expect, it } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

import { leadFailure } from "./failure";

const err = (status: number, code: string, reason?: string) => new ApiRequestError(status, code, "x", reason);

describe("a refusal from the API becomes one closed word", () => {
  it("says why a file was refused, with the reason", () => {
    expect(leadFailure(err(422, "sheet_refused", "too_many_rows"))).toEqual({ ok: false, error: "sheet_refused", reason: "too_many_rows" });
    expect(leadFailure(err(422, "sheet_refused", "something_new"))).toEqual({ ok: false, error: "sheet_refused", reason: "unreadable" });
    expect(leadFailure(err(422, "sheet_not_public")).error).toBe("sheet_not_public");
    expect(leadFailure(err(422, "sheet_link_invalid")).error).toBe("sheet_link_invalid");
    expect(leadFailure(err(422, "mapping_required_missing")).error).toBe("mapping_required_missing");
    expect(leadFailure(err(422, "validation_error")).error).toBe("invalid");
    expect(leadFailure(err(502, "sheet_unreachable")).error).toBe("sheet_unreachable");
  });
  it("roles, the second factor, a read-only workspace, a reused import id and size", () => {
    expect(leadFailure(err(403, "mfa_required")).error).toBe("mfa");
    expect(leadFailure(err(403, "workspace_read_only")).error).toBe("read_only");
    expect(leadFailure(err(403, "forbidden")).error).toBe("forbidden");
    expect(leadFailure(err(409, "import_id_used")).error).toBe("import_id_used");
    expect(leadFailure(err(413, "too_large")).error).toBe("too_large");
    expect(leadFailure(err(429, "rate_limited")).error).toBe("rate_limited");
  });
  it("the real-data gate is said plainly, whatever its status", () => {
    expect(leadFailure(err(422, "real_data_gate")).error).toBe("real_data_gate");
    expect(leadFailure(err(403, "forbidden", "real_data_gate")).error).toBe("real_data_gate");
  });
  it("a connector that is not switched on, a missing source and anything else", () => {
    expect(leadFailure(err(503, "connector_not_available")).error).toBe("connector_not_available");
    expect(leadFailure(err(503, "lead_sources_unavailable")).error).toBe("not_available");
    expect(leadFailure(err(404, "not_found")).error).toBe("not_available");
    expect(leadFailure(err(500, "boom")).error).toBe("down");
    expect(leadFailure(new Error("x")).error).toBe("down");
  });
  it("a rejected session is passed on, so the page sends the person to sign in", () => {
    expect(() => leadFailure(new ApiAuthError("x"))).toThrow(ApiAuthError);
  });
});
