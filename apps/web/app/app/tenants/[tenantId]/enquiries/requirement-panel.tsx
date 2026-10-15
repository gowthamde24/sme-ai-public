import Link from "next/link";

import { type Enquiry, type RequirementField, type RequirementView } from "@/lib/api/enquiries";

import { addFieldAction, confirmRequirementAction, decideFieldAction, discardRequirementAction, extractRequirementAction } from "./actions";
import { AddFieldForm } from "./add-field-form";
import { ExtractForm } from "./extract-form";
import { FieldControls } from "./field-controls";
import { QuestionList } from "./question-list";
import { RequirementActions } from "./requirement-actions";
import { Pill } from "@/components/v2/app/parts";
import { bigText, hintInline, link, listItemCard, listPlain, mutedText, noteBlock, pageH2, pageH3, plainText, rowBetween, rowWrap } from "@/components/v2/app/ui";
import { makeT, type Say, type Words } from "@/components/v2/app/words";

type Props = {
  tenantId: string;
  enquiry: Enquiry;
  view: RequirementView;
  canWrite: boolean;
  runId: string;
  words?: Words;
  /** The workspace sells by area, weight or piece (module `materials`): the add-a-field form offers that vocabulary. */
  materials?: boolean;
};

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "plain" | "warn" }) {
  return <Pill tone={tone === "good" ? "green" : tone === "warn" ? "amber" : "neutral"}>{children}</Pill>;
}

function origin(f: RequirementField, t: Say): string {
  return f.created_via === "agent" ? t("enq.by_assistant") : t("enq.by_person");
}

function groups(fields: RequirementField[], t: Say): { title: string; fields: RequirementField[] }[] {
  const order = fields.filter((f) => f.line_no === null);
  const lineNos = [...new Set(fields.filter((f) => f.line_no !== null).map((f) => f.line_no as number))].sort((a, b) => a - b);
  return [
    ...lineNos.map((n) => ({ title: t("enq.line_n", { n }), fields: fields.filter((f) => f.line_no === n) })),
    ...(order.length ? [{ title: t("enq.whole_order"), fields: order }] : []),
  ];
}

/**
 * The requirement of one enquiry: the fields the assistant suggested (each with the words it relies on), what a person decided, what is
 * missing, and clarifying questions to copy. EVERYTHING that came from the enquiry text (a quote, a city) is untrusted and shown as plain text.
 * "Suggested" means nobody has checked it; "Approved" is only ever a person's decision. Nothing on this page sends anything.
 */
export function RequirementPanel({ tenantId, enquiry, view, canWrite, runId, words, materials = false }: Props) {
  const t = makeT(words);
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
          {t("enq.requirement")}
        </h2>
        <p className={bigText}>{t("enq.this_enquiry_is_quoted_with_typed")}</p>
        <p className={mutedText}>
          {t("enq.to_quote_it_line_by_line")}
        </p>
        {canWrite ? (
          <RequirementActions words={words}
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
        {t("enq.requirement")}
      </h2>
      <div className={rowWrap}>
        <Badge tone={status === "confirmed" ? "good" : "plain"}>{status ? t(`enq.reqstatus.${status}`) : t("enq.not_started")}</Badge>
        <Badge tone={view.confirmable ? "good" : "plain"}>{view.confirmable ? t("enq.can_approve") : t("enq.cannot_approve_yet")}</Badge>
        <Badge tone={view.ready_for_quote ? "good" : "warn"}>{view.ready_for_quote ? t("enq.ready_for_a_quote") : t("enq.not_ready_for_a_quote")}</Badge>
      </div>
      <p className={mutedText}>
        {t("enq.approving_needs_a_saree_type_and")}
      </p>

      {requirement && canWrite ? (
        <p>
          <Link href={`/app/tenants/${tenantId}/requirements/${requirement.id}/questions`} className={link}>
            {t("enq.stored_questions_for_the_customer")}
          </Link>
        </p>
      ) : null}

      {canWrite && status !== "confirmed" ? <ExtractForm words={words} action={extractRequirementAction.bind(null, tenantId, enquiry.id)} runId={runId} replaces={draft} /> : null}

      {missing.length + doubtful.length > 0 ? (
        <div role="note" className={noteBlock}>
          {missing.length > 0 ? (
            <p>
              <strong>{t("enq.missing")}</strong>{" "}
              {missing.map((f) => `${t(`enq.field.${f.field_key}`)}${f.line_no ? ` (line ${f.line_no})` : ""}`).join(", ")}
            </p>
          ) : null}
          {doubtful.length > 0 ? (
            <p>
              <strong>{t("enq.please_check")}</strong>{" "}
              {doubtful.map((f) => `${t(`enq.field.${f.field_key}`)}${f.line_no ? ` (line ${f.line_no})` : ""} (${t(`enq.flagkind.${f.kind}`)})`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {view.fields.length === 0 ? (
        <p className={bigText}>{t("enq.no_fields_yet")} {canWrite ? t("enq.suggest_or_add") : ""}</p>
      ) : (
        groups(view.fields, t).map((g) => (
          <div key={g.title}>
            <h3 className={pageH3}>{g.title}</h3>
            <ul className={listPlain}>
              {g.fields.map((f) => (
                <li key={f.id} className={listItemCard}>
                  <div className={rowBetween}>
                    <strong>{t(`enq.field.${f.field_key}`)}</strong>
                    <Badge tone={f.state === "confirmed" || f.state === "corrected" ? "good" : f.state === "rejected" ? "plain" : "warn"}>
                      {t(`enq.fstate.${f.state}`)}
                    </Badge>
                  </div>
                  <p className={`${bigText} ${plainText}`}>
                    {f.display || "—"}
                  </p>
                  <p className={hintInline}>
                    {origin(f, t)}; {t(`enq.certainty.${f.certainty}`)}
                    {f.conflict ? t("enq.the_enquiry_gives_more_than_one") : ""}
                  </p>
                  {f.quote ? (
                    <p className={`${hintInline} ${plainText}`}>
                      {t("enq.from_enquiry")} <q>{f.quote}</q>
                    </p>
                  ) : null}
                  {canWrite && draft ? (
                    <FieldControls words={words} decide={decide(f.id)} decided={f.state !== "proposed"} label={f.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <h3 className={pageH3}>{t("enq.questions_you_may_want_to_ask")}</h3>
      <p className={mutedText}>{t("enq.draft_wording_only_copy_it_into")}</p>
      <QuestionList words={words} questions={view.questions} />

      {canWrite && status !== "confirmed" ? (
        <div>
          <h3 className={pageH3}>{t("enq.add_a_field_the_suggestions_missed")}</h3>
          <AddFieldForm words={words} materials={materials} add={addFieldAction.bind(null, tenantId, enquiry.id)} />
        </div>
      ) : null}

      {canWrite && requirement && (status === "draft" || status === "confirmed") ? (
        <div>
          <h3 className={pageH3}>{status === "confirmed" ? t("enq.this_requirement_is_approved") : t("enq.approve_the_requirement")}</h3>
          <RequirementActions words={words}
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
