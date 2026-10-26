/**
 * Next's server hooks (job DP part 6). `onRequestError` is called for every error a server component, route handler or action throws; it reports the error (class name and stack, nothing a person said) when SENTRY_DSN is
 * set (lib/observability/report.ts) and does nothing otherwise. The route PATTERN is passed, never the address asked for.
 */
import { reportServerError } from "@/lib/observability/report";

export function register(): void {
  // nothing to start: there is no SDK
}

export async function onRequestError(error: unknown, _request: { path: string; method: string }, context: { routePath: string; routeType: string }): Promise<void> {
  const digest = typeof (error as { digest?: unknown })?.digest === "string" ? (error as { digest: string }).digest : undefined;
  await reportServerError(error, { routePath: context.routePath, routeType: context.routeType, digest });
}
