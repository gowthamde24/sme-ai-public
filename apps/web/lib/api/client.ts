import type { ApiError, Me, TenantDetail } from "@contracts";

/**
 * Server-side client for the FastAPI service. Runs on the server only, with the signed-in user's
 * own access token. Responses are validated, not trusted: a body that does not match the contract
 * is an error, never rendered.
 */
export class ApiAuthError extends Error {}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ApiContractError extends Error {}

const ROLES = ["owner", "admin", "sales", "viewer"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRole(value: unknown): value is Me["memberships"][number]["role"] {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

export function parseMe(json: unknown): Me {
  if (
    !isRecord(json) ||
    !isString(json.user_id) ||
    !Array.isArray(json.memberships)
  ) {
    throw new ApiContractError("Unexpected /v1/me response.");
  }
  const memberships = json.memberships.map((m: unknown) => {
    if (
      !isRecord(m) ||
      !isRole(m.role) ||
      !isRecord(m.tenant) ||
      !isString(m.tenant.id) ||
      !isString(m.tenant.name) ||
      !isString(m.tenant.slug)
    ) {
      throw new ApiContractError("Unexpected membership in /v1/me response.");
    }
    return {
      role: m.role,
      tenant: { id: m.tenant.id, name: m.tenant.name, slug: m.tenant.slug },
    };
  });
  return { user_id: json.user_id, memberships };
}

export function parseTenantDetail(json: unknown): TenantDetail {
  if (
    !isRecord(json) ||
    !isString(json.id) ||
    !isString(json.name) ||
    !isString(json.slug) ||
    !isRole(json.role)
  ) {
    throw new ApiContractError("Unexpected tenant response.");
  }
  return { id: json.id, name: json.name, slug: json.slug, role: json.role };
}

function apiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_API_BASE_URL is required in production.");
    }
    return "http://localhost:8000";
  }
  return base.replace(/\/+$/, "");
}

export async function apiRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<unknown> {
  const base = apiBaseUrl(); // misconfiguration must surface as itself, not as "unreachable"
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ApiRequestError(
      503,
      "api_unreachable",
      "The API is unreachable.",
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body; handled by the status checks below
  }

  if (response.status === 401)
    throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) {
    const err =
      isRecord(body) && isRecord(body.error)
        ? (body.error as ApiError["error"])
        : null;
    throw new ApiRequestError(
      response.status,
      err && isString(err.code) ? err.code : "http_error",
      err && isString(err.message) ? err.message : "Request failed.",
    );
  }
  return body;
}

export async function fetchMe(accessToken: string): Promise<Me> {
  return parseMe(await apiRequest("/v1/me", accessToken));
}

/** One workspace as the caller sees it (name, slug and the caller's role). 404 = not found / not a member. */
export async function fetchTenant(
  accessToken: string,
  tenantId: string,
): Promise<TenantDetail> {
  return parseTenantDetail(
    await apiRequest(
      `/v1/tenants/${encodeURIComponent(tenantId)}`,
      accessToken,
    ),
  );
}

export async function createTenant(
  accessToken: string,
  name: string,
  slug: string,
): Promise<TenantDetail> {
  return parseTenantDetail(
    await apiRequest("/v1/tenants", accessToken, {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    }),
  );
}

export interface ExportDownloadResult {
  content: string;
  sha256: string;
  rowCount: number;
  contentType: string;
}

export async function apiExportRequest(
  path: string,
  accessToken: string,
  body: unknown,
): Promise<ExportDownloadResult> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(
      503,
      "api_unreachable",
      "The API is unreachable.",
    );
  }

  if (response.status === 401)
    throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) {
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      // non-JSON body
    }
    const err =
      isRecord(errBody) && isRecord(errBody.error)
        ? (errBody.error as ApiError["error"])
        : null;
    throw new ApiRequestError(
      response.status,
      err && isString(err.code) ? err.code : "http_error",
      err && isString(err.message) ? err.message : "Request failed.",
    );
  }

  const content = await response.text();
  const sha256 = response.headers.get("X-Export-Sha256") || "";
  const rowCount = parseInt(response.headers.get("X-Export-Rows") || "0", 10);
  const contentType =
    response.headers.get("Content-Type") || "text/csv; charset=utf-8";

  return { content, sha256, rowCount, contentType };
}
