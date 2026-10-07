import Link from "next/link";

import type { DueItem } from "@/lib/api/followups";

import { dueLine } from "./followup-logic";

/**
 * The leads with a recorded first message, each put to the pinned rules when this page was opened (there is no scheduler and nothing runs in the background). It is GUIDANCE: opening a lead and
 * asking for a draft makes the database decide again. Nothing here sends a message.
 */
export function DueView({ tenantId, items }: { tenantId: string; items: DueItem[] }) {
  const base = `/app/tenants/${tenantId}`;
  return (
    <section aria-labelledby="due-heading">
      <h1 id="due-heading">Follow-ups due</h1>
      <p role="note" className="hint">
        Worked out when you opened this page. Guidance only: the database decides again when you ask for a draft.
      </p>
      {items.length === 0 ? (
        <p>Nothing to follow up: no lead has a recorded first message yet, or no policy is in force.</p>
      ) : (
        <ul aria-label="Leads with a follow-up">
          {items.map((i) => (
            <li key={i.lead_id} className="card">
              <Link href={`${base}/leads/${i.lead_id}/followup`} className="tap">
                <strong>{i.action === "draft_followup" ? "Due now" : i.action === "wait" ? "Not yet" : "No follow-up"}</strong>
              </Link>{" "}
              · {dueLine(i)}
              {i.open_draft_id ? (
                <>
                  <br />
                  <span className="hint">A draft is waiting: open the lead to read and approve it.</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
