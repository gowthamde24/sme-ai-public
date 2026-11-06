"use client";

import { useRouter } from "next/navigation";

/**
 * App v4's day picker on Store visits (owner, 6 Nov 2026): the day opens as soon as it is picked, with no "Show" button. It is still a GET form, so without script, Enter opens the day.
 */
export function DatePick({ action, day, label, className }: { action: string; day: string; label: string; className: string }) {
  const router = useRouter();
  return (
    <form method="get" action={action} className="ml-auto flex items-center gap-2 max-md:basis-full">
      <label htmlFor="visits-date" className="sr-only">
        {label}
      </label>
      <input id="visits-date" name="date" type="date" defaultValue={day} className={className} onChange={(e) => e.currentTarget.value && router.push(`${action}?date=${e.currentTarget.value}`)} />
    </form>
  );
}
