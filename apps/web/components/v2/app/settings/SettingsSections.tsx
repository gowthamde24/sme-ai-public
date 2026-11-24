"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Settings as a grouped list (owner/planner, 25 Nov 2026; SETTINGS_OPEN): Business | Team | Assistant | Quotes and limits | Language and alerts | More, the pages of the open group under it; on a phone ONE select "Section".
 * The pages and their addresses are the old tabs' (`?section=`): nothing moved, only how they are listed.
 */
export type SectionGroup = { key: string; label: string; items: readonly { key: string; label: string; href: string; current: boolean }[] };

export function SettingsSections({ groups, label, selectLabel }: { groups: readonly SectionGroup[]; label: string; selectLabel: string }) {
  const router = useRouter();
  const live = groups.filter((g) => g.items.length > 0);
  const open = live.find((g) => g.items.some((i) => i.current)) ?? live[0];
  const current = live.flatMap((g) => g.items).find((i) => i.current);
  return (
    <nav aria-label={label} data-part="settings-sections" className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-[15px] font-semibold text-ink md:hidden">
        {selectLabel}
        <select
          value={current?.href ?? ""}
          onChange={(e) => router.push(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-edge bg-transparent px-3 text-[16px] font-normal text-ink"
        >
          {live.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map((i) => (
                <option key={i.key} value={i.href}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="hidden flex-col gap-1.5 md:flex">
        <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 border-b border-line p-0">
          {live.map((g) => (
            <li key={g.key}>
              <Link href={g.items[0].href} aria-current={g === open ? "true" : undefined} className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-[16px] ${g === open ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
                {g.label}
              </Link>
            </li>
          ))}
        </ul>
        {open && open.items.length > 1 ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-0 p-0">
            {open.items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} aria-current={i.current ? "page" : undefined} className={`inline-flex min-h-11 items-center text-[15px] ${i.current ? "font-semibold text-ink underline underline-offset-4" : "text-muted hover:text-ink"}`}>
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}
