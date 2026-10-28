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
    /** A closed reason code the API adds to a refusal of the lifecycle's rules (orders); never free text. */
    readonly reason?: string,
    /** `ai_paused_until` only: the ISO time the AI features can be used again (the allowance of the day or the month is used up). */
    readonly until?: string,
    /** A 429 only: the seconds the API asks the caller to wait (its Retry-After header), when it gave a sensible number. */
    readonly retryAfter?: number,
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

/**
 * Every call from the web's SERVER to the API goes through this `fetch`, which shadows the global one inside this file. When ORIGIN_LOCK_SECRET is set (job DT, docs/runbooks/origin-lock.md) the API answers only
 * requests that carry it in X-Stack19-Origin; unset = nothing is added.
 */
const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
  const secret = process.env.ORIGIN_LOCK_SECRET;
  if (!secret) return globalThis.fetch(url, init);
  return globalThis.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), "X-Stack19-Origin": secret } });
};

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

function untilOf(err: ApiError["error"] | null): string | undefined {
  const until = err ? (err as unknown as { until?: unknown }).until : undefined;
  return typeof until === "string" && until.length <= 40 ? until : undefined;
}

function reasonOf(err: ApiError["error"] | null): string | undefined {
  const reason = err ? (err as unknown as { reason?: unknown }).reason : undefined;
  return typeof reason === "string" ? reason : undefined;
}


/** The seconds in a Retry-After header, or undefined (an HTTP date, a negative or an absurd number is not used). */
export function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{1,5}$/.test(value.trim())) return undefined;
  const n = Number(value.trim());
  return n >= 1 && n <= 86_400 ? n : undefined;
}

/**
 * The error a refused answer becomes (one place for apiRequest, the raw upload and the file download). The API's own refusals carry `{error: {code, message}}`; the rate limiter's 429 is `{error: "rate_limited"}`
 * with a Retry-After header, and a body over the ceiling is `{error: "payload_too_large"}`: a plain string code. Nothing from the body but a closed code and the API's fixed sentence is kept.
 */
export function refusal(status: number, body: unknown, retryAfterHeader: string | null = null): ApiRequestError {
  const raw = isRecord(body) ? body.error : null;
  const err = isRecord(raw) ? (raw as ApiError["error"]) : null;
  const plain = typeof raw === "string" && /^[a-z_]{1,40}$/.test(raw) ? raw : null;
  const code = err && isString(err.code) ? err.code : (plain ?? (status === 429 ? "rate_limited" : "http_error"));
  // since job CD every refusal is {error: {code, message, retry_after, request_id}}: the seconds are in the body as well as in the header (the header wins)
  const inBody = err && typeof (err as { retry_after?: unknown }).retry_after === "number" ? retryAfterSeconds(String((err as { retry_after: number }).retry_after)) : undefined;
  return new ApiRequestError(status, code, err && isString(err.message) ? err.message : "Request failed.", reasonOf(err), untilOf(err), status === 429 ? (retryAfterSeconds(retryAfterHeader) ?? inBody) : undefined);
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
  if (!response.ok) throw refusal(response.status, body, response.headers.get("Retry-After"));
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

/**
 * A POST whose answer is a STREAM of server-sent events (the Main agent). The status is judged before any byte is read, exactly as apiRequest does: a 401 is an
 * ApiAuthError and any other refusal an ApiRequestError with the API's fixed code and sentence; only a 200 comes back as a Response whose body the caller reads.
 */
export async function apiStreamRequest(path: string, accessToken: string, body: unknown): Promise<Response> {
  return streamPost(path, accessToken, "application/json", JSON.stringify(body));
}

/** The same, for a body that is a file sent as it is (a recording for the voice route, job BF): its own Content-Type, the status judged before any byte of the answer is read. */
export async function apiStreamUpload(path: string, accessToken: string, body: ArrayBuffer, contentType: string): Promise<Response> {
  return streamPost(path, accessToken, contentType, body);
}

async function streamPost(path: string, accessToken: string, contentType: string, body: string | ArrayBuffer): Promise<Response> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": contentType, Accept: "text/event-stream", Authorization: `Bearer ${accessToken}` },
      body,
    });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  }
  if (response.status === 401) throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) {
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      // non-JSON body
    }
    const err = isRecord(errBody) && isRecord(errBody.error) ? (errBody.error as ApiError["error"]) : null;
    throw new ApiRequestError(
      response.status,
      err && isString(err.code) ? err.code : "http_error",
      err && isString(err.message) ? err.message : "Request failed.",
      undefined,
      untilOf(err),
    );
  }
  if (!response.body) throw new ApiContractError("The stream has no body.");
  return response;
}

/**
 * A POST whose BODY is a file, sent as it is with its own Content-Type (a photo of the catalogue: the API reads the raw body, not JSON). The status is judged exactly as apiRequest does, and the
 * answer is JSON. The caller has already checked the size and the type; the API checks them again from the bytes.
 */
export async function apiUploadRequest(path: string, accessToken: string, body: ArrayBuffer | Blob, contentType: string): Promise<unknown> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": contentType, Authorization: `Bearer ${accessToken}` },
      body,
    });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // non-JSON body; handled by the status checks below
  }
  if (response.status === 401) throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) throw refusal(response.status, json, response.headers.get("Retry-After"));
  return json;
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

export interface FileDownload {
  bytes: ArrayBuffer;
  contentType: string;
  /** The file name the API suggested (its Content-Disposition), or null. */
  filename: string | null;
  /** The few X- headers the screens show (counts and a hash), by lower-case name. */
  headers: Record<string, string>;
}

const SHOWN_HEADERS = ["x-export-id", "x-export-sales", "x-export-payments", "x-content-sha256"] as const;

/** The name in a Content-Disposition header, only if it is a plain safe file name (letters, digits, dot, dash, underscore). */
export function suggestedFilename(disposition: string | null): string | null {
  const m = disposition ? /filename="?([A-Za-z0-9._-]{1,120})"?\s*(?:;|$)/.exec(disposition) : null;
  return m && /[A-Za-z0-9]/.test(m[1]) ? m[1] : null;
}

/** A POST (JSON body) whose good answer is a FILE, as bytes. The status is judged first, exactly as apiRequest does. */
export async function apiDownloadRequest(path: string, accessToken: string, body: unknown): Promise<FileDownload> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  }
  if (response.status === 401) throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) {
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      // non-JSON body
    }
    throw refusal(response.status, errBody, response.headers.get("Retry-After"));
  }
  const headers: Record<string, string> = {};
  for (const name of SHOWN_HEADERS) {
    const v = response.headers.get(name);
    if (v !== null && v.length <= 100) headers[name] = v;
  }
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("Content-Type") ?? "application/octet-stream", filename: suggestedFilename(response.headers.get("Content-Disposition")), headers };
}

/** A GET whose good answer is a SOUND or another small file, as bytes (job DQ part 3: a voice sample). The status is judged first; an answer longer than `max` bytes is refused. */
export async function apiBinaryRequest(path: string, accessToken: string, max: number): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  }
  if (response.status === 401) throw new ApiAuthError("The API rejected the session.");
  if (!response.ok) {
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      // non-JSON body
    }
    throw refusal(response.status, errBody, response.headers.get("Retry-After"));
  }
  const length = Number(response.headers.get("Content-Length") ?? "0");
  if (length > max) throw new ApiContractError("The file is too large.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > max) throw new ApiContractError("The file is too large.");
  return { bytes, contentType: response.headers.get("Content-Type") ?? "application/octet-stream" };
}

/** The API's public address, as a calendar app or a phone must be given it (the browser never calls the API itself; this is only for a link a person copies). */
export function publicApiBase(): string {
  return apiBaseUrl();
}

/** A request to a public route (no sign-in: `GET /v1/policies/current`, `POST /v1/public/waitlist`): no Authorization header. The status is judged as for every other request; a rejected session cannot happen here, so a 401 is just a refusal. */
export async function apiPublicRequest(path: string, init: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
  const base = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { cache: "no-store", method: init.method ?? "GET", ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }), headers: { ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers } });
  } catch {
    throw new ApiRequestError(503, "api_unreachable", "The API is unreachable.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body; handled by the status check below
  }
  if (!response.ok) throw refusal(response.status, body, response.headers.get("Retry-After"));
  return body;
}
