/**
 * Public Supabase settings. These two values are the ONLY Supabase configuration the web app is
 * allowed to know: the project URL and the anon/publishable key. Both are public by design (the
 * anon key grants nothing without a signed-in user and row-level security).
 *
 * No privileged credential of any kind exists in apps/web; test/guards.test.ts enforces that.
 */
export type SupabasePublicConfig = { url: string; anonKey: string };

export function getSupabasePublicConfig(): SupabasePublicConfig {
  // Literal property access is required: Next.js inlines NEXT_PUBLIC_* at build time.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed: never fall back to a default project.
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use https in production.");
  }
  return { url, anonKey };
}
