import Link from "next/link";

/**
 * The one not-found page. A tenant page the caller may not see, a tenant that does not exist and a
 * malformed id all end up here, so the response never reveals which of them it was.
 */
export default function NotFound() {
  return (
    <main className="shell">
      <h1>Not found</h1>
      <p>We could not find that page.</p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}
