/**
 * Error reporting to Sentry for the web's SERVER (job DP part 6), off unless SENTRY_DSN is set. No SDK and no new dependency: a Sentry event is one small JSON document posted to the project's envelope address.
 * Why not @sentry/nextjs: it adds a browser bundle (the route-JS budget audit), needs a looser Content-Security-Policy (`connect-src 'self'` is pinned by tests), and by default collects request data we never want to leave.
 *
 * WHAT LEAVES when it is on: the error's CLASS NAME and its stack frames (file inside the build, function, line, column: no source lines, no variables), the release, the environment, the route PATTERN (for example
 * `/app/tenants/[tenantId]/today`, never the address that was asked for) and Next's digest. NOTHING else: no message (it may hold a name or a number), no URL, query, header, cookie or body, no user, no IP address.
 * It never throws and never waits long: a failure to report is dropped.
 *
 * The browser does not report (its policy lets it talk to this app only); a browser-side reporter needs a CSP change and the owner's decision.
 */

export type ParsedDsn = { key: string; host: string; projectId: string };

export type ReportContext = { routePath?: string; routeType?: string; digest?: string };

const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const TIMEOUT_MS = 2000;

/** `https://PUBLICKEY@HOST/PROJECTID`, https only; anything else is "not configured". */
export function parseDsn(dsn: string | undefined | null): ParsedDsn | null {
  if (!dsn) return null;
  const match = /^https:\/\/([A-Za-z0-9]{8,64})@([A-Za-z0-9.-]+)\/(\d{1,12})$/.exec(dsn.trim());
  return match ? { key: match[1], host: match[2], projectId: match[3] } : null;
}

/** A file path inside the build or a package only: the part from `.next/` or `node_modules/` on, else the file's last two segments. Never an absolute path of the machine. */
export function safeFile(path: string): string {
  const clean = path.replace(/^file:\/\//, "").split("?")[0];
  const next = clean.indexOf(".next/");
  if (next >= 0) return clean.slice(next);
  const pkg = clean.lastIndexOf("node_modules/");
  if (pkg >= 0) return clean.slice(pkg);
  return clean.split("/").slice(-2).join("/");
}

export function frames(stack: string | undefined): { filename: string; function: string; lineno: number; colno: number; in_app: boolean }[] {
  const out: { filename: string; function: string; lineno: number; colno: number; in_app: boolean }[] = [];
  for (const line of (stack ?? "").split("\n").slice(1, 41)) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const filename = safeFile(m[2]);
    out.push({ filename, function: (m[1] ?? "?").replace(/[^\w.$<>[\] ]/g, "").slice(0, 80) || "?", lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes("node_modules") });
  }
  return out.reverse(); // Sentry wants the oldest call first
}

const SAFE_ROUTE = /^[\w\-./[\]()@]{1,200}$/;

export function buildEvent(err: unknown, ctx: ReportContext, env: { release: string; environment: string }, now: Date = new Date(), id: string = crypto.randomUUID().replace(/-/g, "")): Record<string, unknown> {
  const e = err instanceof Error ? err : null;
  const type = (e?.name || "Error").replace(/[^\w.$]/g, "").slice(0, 100) || "Error";
  const tags: Record<string, string> = { surface: "web-server" };
  if (ctx.routePath && SAFE_ROUTE.test(ctx.routePath)) tags.route = ctx.routePath;
  if (ctx.routeType && /^[a-z-]{1,30}$/.test(ctx.routeType)) tags.route_type = ctx.routeType;
  if (ctx.digest && /^[\w-]{1,40}$/.test(ctx.digest)) tags.digest = ctx.digest;
  return {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: "javascript",
    level: "error",
    release: env.release,
    environment: env.environment,
    server_name: "web",
    tags,
    exception: { values: [{ type, stacktrace: { frames: frames(e?.stack) } }] },
  };
}

export function buildEnvelope(event: Record<string, unknown>, dsn: string, now: Date = new Date()): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

/** Report one server error. Returns whether something was sent. A no-op without a DSN. Never throws. */
export async function reportServerError(err: unknown, ctx: ReportContext = {}, env: NodeJS.ProcessEnv = process.env, send: typeof fetch = fetch): Promise<boolean> {
  try {
    const dsn = env.SENTRY_DSN;
    const parsed = parseDsn(dsn);
    if (!parsed || !dsn) return false;
    const event = buildEvent(err, ctx, { release: env.SENTRY_RELEASE || env.NEXT_PUBLIC_APP_VERSION || "web", environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "production" });
    const response = await send(`https://${parsed.host}/api/${parsed.projectId}/envelope/`, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=stack19-web/1` },
      body: buildEnvelope(event, dsn),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
