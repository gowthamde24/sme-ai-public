"use client";

import Link from "next/link";
import * as React from "react";

import { alertBox, btnQuiet, okBox } from "../ui";

type W = Readonly<Record<string, string>>;
export type RemindFn = (campaignId: string, input: { companyId: string | null; contactId: string | null; name: string }) => Promise<{ ok: true; campaignId: string; added: number } | { ok: false; error: string }>;

/**
 * "Remind" (app v4 part 6): makes a DRAFT reminder for this one customer and says so; it never sends. The owner approves the draft on the campaign page, which the answer links to. The id of the draft is made here once per row, so a second
 * press (or a retry) changes the same draft instead of making another. A customer with no contact has nobody to message: the button gives way to a sentence.
 */
export function RemindButton({ w, campaignsHref, row, remind }: { w: W; /** where a campaign draft is opened (`.../campaigns`); null = the person may not see campaigns */ campaignsHref: string | null; row: { companyId: string | null; contactId: string | null; name: string }; remind: RemindFn }) {
  const [id] = React.useState(() => crypto.randomUUID());
  const [state, setState] = React.useState<{ ok: true; campaignId: string } | { ok: false; error: string } | null>(null);
  const [busy, start] = React.useTransition();
  if (row.contactId === null) return <span className="text-sm text-muted" data-part="no-contact">{w["mo.no_contact"]}</span>;
  if (state?.ok)
    return (
      <p role="status" className={`${okBox} m-0 text-sm`} data-part="remind-done">
        {w["mo.draft"]}{" "}
        {campaignsHref ? (
          <Link href={`${campaignsHref}/${state.campaignId}`} className="font-semibold underline underline-offset-4">
            {w["mo.open_draft"]}
          </Link>
        ) : null}
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        className={`${btnQuiet} !min-h-11`}
        data-part="remind"
        onClick={() =>
          start(async () => {
            const out = await remind(id, row);
            setState(out.ok ? { ok: true, campaignId: out.campaignId } : { ok: false, error: out.error });
          })
        }
      >
        {busy ? w["mo.working"] : w["mo.remind"]}
      </button>
      {state && !state.ok ? (
        <p role="alert" className={`${alertBox} m-0 text-sm`}>
          {w[`mo.err.${state.error}`] ?? w["mo.err.down"]}
        </p>
      ) : null}
    </div>
  );
}
