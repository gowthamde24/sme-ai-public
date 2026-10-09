import Link from "next/link";

import {
  CERTAINTY_LABELS,
  FIELD_LABELS,
  FIELD_STATE_LABELS,
  FLAG_LABELS,
  REQUIREMENT_STATUS_LABELS,
  type Enquiry,
  type RequirementField,
  type RequirementView,
} from "@/lib/api/enquiries";

import { addFieldAction, confirmRequirementAction, decideFieldAction, discardRequirementAction, extractRequirementAction } from "./actions";
import { AddFieldForm } from "./add-field-form";
import { ExtractForm } from "./extract-form";
import { FieldControls } from "./field-controls";
import { QuestionList } from "./question-list";
import { RequirementActions } from "./requirement-actions";
import { Pill } from "@/components/v2/app/parts";
import { bigText, hintInline, link, listItemCard, listPlain, mutedText, noteBlock, pageH2, pageH3, plainText, rowBetween, rowWrap } from "@/components/v2/app/ui";

type Props = {
  tenantId: string;
  enquiry: Enquiry;
  view: RequirementView;
  canWrite: boolean;
  runId: string;
};

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "plain" | "warn" }) {
  return <Pill tone={tone === "good" ? "green" : tone === "warn" ? "amber" : "neutral"}>{children}</Pill>;
}

function origin(f: RequirementField): string {
  return f.created_via === "agent" ? "suggested by the assistant" : "entered by a person";
}

function groups(fields: RequirementField[]): { title: string; fields: RequirementField[] }[] {
  const order = fields.filter((f) => f.line_no === null);
  const lineNos = [...new Set(fields.filter((f) => f.line_no !== null).map((f) => f.line_no as number))].sort((a, b) => a - b);
  return [
    ...lineNos.map((n) => ({ title: `Line ${n}`, fields: fields.filter((f) => f.line_no === n) })),
    ...(order.length ? [{ title: "The whole order", fields: order }] : []),
  ];
}

/**
 * The requirement of one enquiry: the fields the assistant suggested (each with the words it relies on), what a person decided, what is
 * missing, and clarifying questions to copy. EVERYTHING that came from the enquiry text (a quote, a city) is untrusted and shown as plain text.
 * "Suggested" means nobody has checked it; "Approved" is only ever a person's decision. Nothing on this page sends anything.
 */
export function RequirementPanel({ tenantId, enquiry, view, canWrite, runId }: Props) {
  const requirement = view.requirement;
  const status = requirement?.status ?? null;
  const draft = status === "draft";
  const decide = (fieldId: string) => decideFieldAction.bind(null, tenantId, enquiry.id, fieldId);
  // A confirmed requirement with NO fields is what a quote with typed prices leaves behind (the database makes it so the quote has something to hang on). The line-by-line flow
  // can never produce one (approving needs a line with a type and a quantity), so this is the typed-price case and none of the list-flow wording is about it.
  if (requirement && status === "confirmed" && view.fields.length === 0) {
    return (
      <section aria-labelledby="requirement-heading">
        <h2 id="requirement-heading" className={pageH2}>
          Requirement
        </h2>
        <p className={bigText}>This enquiry is quoted with typed prices, so there are no lines to approve here.</p>
        <p className={mutedText}>
          To quote it line by line from the price list instead, reject or withdraw its quotes, then discard this requirement. Nothing here is ever sent.
        </p>
        {canWrite ? (
          <RequirementActions
            confirm={confirmRequirementAction.bind(null, tenantId, enquiry.id, requirement.id)}
            discard={discardRequirementAction.bind(null, tenantId, enquiry.id, requirement.id)}
            status="confirmed"
            confirmable={false}
          />
        ) : null}
      </section>
    );
  }
  const missing = view.flags.filter((f) => f.kind === "missing");
  const doubtful = view.flags.filter((f) => f.kind !== "missing");
  return (
    <section aria-labelledby="requirement-heading">
      <h2 id="requirement-heading" className={pageH2}>
        Requirement
      </h2>
      <div className={rowWrap}>
        <Badge tone={status === "confirmed" ? "good" : "plain"}>{status ? REQUIREMENT_STATUS_LABELS[status] : "Not started"}</Badge>
        <Badge tone={view.confirmable ? "good" : "plain"}>{view.confirmable ? "Can approve" : "Cannot approve yet"}</Badge>
        <Badge tone={view.ready_for_quote ? "good" : "warn"}>{view.ready_for_quote ? "Ready for a quote" : "Not ready for a quote"}</Badge>
      </div>
      <p className={mutedText}>
        Approving needs a saree type and a quantity on the same line, approved by a person. &quot;Ready for a quote&quot; also needs the delivery city, the date it
        is needed and the payment terms. Nothing here is ever sent.
      </p>

      {requirement && canWrite ? (
        <p>
          <Link href={`/app/tenants/${tenantId}/requirements/${requirement.id}/questions`} className={link}>
            Stored questions for the customer →
          </Link>
        </p>
      ) : null}

      {canWrite && status !== "confirmed" ? <ExtractForm action={extractRequirementAction.bind(null, tenantId, enquiry.id)} runId={runId} replaces={draft} /> : null}

      {missing.length + doubtful.length > 0 ? (
        <div role="note" className={noteBlock}>
          {missing.length > 0 ? (
            <p>
              <strong>Missing:</strong>{" "}
              {missing.map((f) => `${FIELD_LABELS[f.field_key]}${f.line_no ? ` (line ${f.line_no})` : ""}`).join(", ")}
            </p>
          ) : null}
          {doubtful.length > 0 ? (
            <p>
              <strong>Please check:</strong>{" "}
              {doubtful.map((f) => `${FIELD_LABELS[f.field_key]}${f.line_no ? ` (line ${f.line_no})` : ""} (${FLAG_LABELS[f.kind]})`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.fields.length === 0 ? (
        <p className={bigText}>No fields yet. {canWrite ? "Suggest the fields, or add them by hand below." : ""}</p>
      ) : (
        groups(view.fields).map((g) => (
          <div key={g.title}>
            <h3 className={pageH3}>{g.title}</h3>
            <ul className={listPlain}>
              {g.fields.map((f) => (
                <li key={f.id} className={listItemCard}>
                  <div className={rowBetween}>
                    <strong>{FIELD_LABELS[f.field_key]}</strong>
                    <Badge tone={f.state === "confirmed" || f.state === "corrected" ? "good" : f.state === "rejected" ? "plain" : "warn"}>
                      {FIELD_STATE_LABELS[f.state]}
                    </Badge>
                  </div>
                  <p className={`${bigText} ${plainText}`}>
                    {f.display || "—"}
                  </p>
                  <p className={hintInline}>
                    {origin(f)}; {CERTAINTY_LABELS[f.certainty]}
                    {f.conflict ? "; the enquiry gives more than one value" : ""}
                  </p>
                  {f.quote ? (
                    <p className={`${hintInline} ${plainText}`}>
                      From the enquiry: <q>{f.quote}</q>
                    </p>
                  ) : null}
                  {canWrite && draft ? (
                    <FieldControls decide={decide(f.id)} decided={f.state !== "proposed"} label={f.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <h3 className={pageH3}>Questions you may want to ask the customer</h3>
      <p className={mutedText}>Draft wording only: copy it into your own message. This application does not send anything.</p>
      <QuestionList questions={view.questions} />

      {canWrite && status !== "confirmed" ? (
        <div>
          <h3 className={pageH3}>Add a field the suggestions missed</h3>
          <AddFieldForm add={addFieldAction.bind(null, tenantId, enquiry.id)} />
        </div>
      ) : null}

      {canWrite && requirement && (status === "draft" || status === "confirmed") ? (
        <div>
          <h3 className={pageH3}>{status === "confirmed" ? "This requirement is approved" : "Approve the requirement"}</h3>
          <RequirementActions
            confirm={confirmRequirementAction.bind(null, tenantId, enquiry.id, requirement.id)}
            discard={discardRequirementAction.bind(null, tenantId, enquiry.id, requirement.id)}
            status={status}
            confirmable={view.confirmable}
          />
        </div>
      ) : null}
    </section>
  );
}
