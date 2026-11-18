"use client";

import { useRouter } from "next/navigation";

/** The phone's way to move between the sections of Train how it talks: one native select (it works with the phone's own picker); choosing one goes to its address. */
export function SectionSelect({ label, current, options }: { label: string; current: string; options: readonly { key: string; label: string; href: string }[] }) {
  const router = useRouter();
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-muted">
      {label}
      <select
        value={current}
        onChange={(e) => {
          const to = options.find((o) => o.key === e.target.value);
          if (to) router.push(to.href);
        }}
        className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base font-semibold text-ink"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
