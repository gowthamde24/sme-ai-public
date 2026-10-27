"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { AssignResult } from "@/lib/lead-desk/leads-source";

import { fieldInput } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Assigned to" for one lead (night 4, part A6): a small select of the team; choosing someone hands the lead to them. The Owner and Admin change it; the others only read the name. A failure puts the old choice back and says so.
 */
export function AssignSelect({ words, leadId, current, members, canEdit, assign }: { words: Words; leadId: string; current: string | null; members: readonly { id: string; name: string }[]; canEdit: boolean; assign: (leadId: string, to: string | null) => Promise<AssignResult> }) {
  const t = makeT(words);
  const router = useRouter();
  const [value, setValue] = React.useState(current ?? "");
  const [error, setError] = React.useState(false);
  const label = members.find((m) => m.id === current)?.name ?? t("ld.desk.unassigned");
  if (!canEdit) return <span className="text-base">{label}</span>;
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={`as-${leadId}`} className="sr-only">
        {t("ld.desk.assigned")}
      </label>
      <select
        id={`as-${leadId}`}
        className={`${fieldInput} !min-h-11`}
        value={value}
        onChange={async (e) => {
          const next = e.target.value;
          const before = value;
          setValue(next);
          setError(false);
          const out = await assign(leadId, next === "" ? null : next).catch((): AssignResult => ({ ok: false, error: "down" }));
          if (out.ok) router.refresh();
          else {
            setValue(before);
            setError(true);
          }
        }}
      >
        <option value="">{t("ld.desk.unassigned")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-sm font-medium text-red-text">
          {t("ld.desk.err.assign")}
        </span>
      ) : null}
    </span>
  );
}
