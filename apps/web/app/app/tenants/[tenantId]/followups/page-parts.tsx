import Link from "next/link";

export const FOLLOWUP_ROLES = ["owner", "admin", "sales"];
export const NOTHING_SENT =
  "Follow-ups are drafts for a person to send outside this system. This system sends nothing: it keeps records of what you did and shows the closed text you copy yourself.";

export function Notice() {
  return (
    <p role="note" className="notice">
      {NOTHING_SENT}
    </p>
  );
}

export function ApiDown() {
  return (
    <main className="shell wide">
      <p role="alert" className="error">
        Could not load this from the API. Try again shortly.
      </p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}

export function NotShown({ tenantId, tenantName, title }: { tenantId: string; tenantName: string; title: string }) {
  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}`}>← {tenantName}</Link>
      </p>
      <h1>{title}</h1>
      <p className="hint">Follow-ups are shown to owners, admins and sales users.</p>
    </main>
  );
}

/** Today's date in India. */
export function todayInIndia(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
