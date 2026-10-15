import Link from "next/link";

/** Links from a customer's page to what a business that delivers and bills on credit does with a customer (job CO): their sites and their account of what is owed. Drawn only for the links the business type and the role have. */
export function CompanyShortcuts({ links }: { links: readonly { href: string; label: string }[] }) {
  if (links.length === 0) return null;
  return (
    <p className="mb-2 flex flex-wrap gap-2" data-part="company-shortcuts">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-base font-semibold hover:bg-surface-2">
          {l.label}
        </Link>
      ))}
    </p>
  );
}
