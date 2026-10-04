import Link from "next/link";

import {
  type EvidenceItem,
  type EvidencePage,
  type EvidenceTarget,
  KIND_LABELS,
} from "@/lib/api/evidence";

import { AddEvidenceForm } from "./add-evidence-form";
import { addEvidenceAction } from "./evidence-actions";

/**
 * The Evidence section of a company / lead page.
 *
 * EVIDENCE IS UNTRUSTED TEXT (CLAUDE.md #6). Every URL, reference and snippet below is rendered as
 * PLAIN TEXT inside ordinary elements: React escapes it, nothing here builds an anchor, an image, a
 * frame, a preview or a prefetch from it, and `white-space: pre-wrap` keeps the snippet's line
 * breaks. The only links on this component are internal ("Load more", built from a validated UUID
 * and the API's opaque cursor). test/guards.test.ts enforces all of this on the source files.
 */
type Props = {
  tenantId: string;
  target: EvidenceTarget;
  targetId: string;
  /** null = the API could not be reached / returned something unexpected. */
  page: EvidencePage | null;
  cursor: string | null;
  canWrite: boolean;
  formId: string;
};

function moment(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}
function day(iso: string): string {
  return iso.slice(0, 10);
}

export function EvidencePanel({
  tenantId,
  target,
  targetId,
  page,
  cursor,
  canWrite,
  formId,
}: Props) {
  const here = `/app/tenants/${tenantId}/${target}/${targetId}`;
  return (
    <section aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Evidence</h2>
      <p className="hint">
        Sources are shown as plain text. They are never opened, fetched or
        previewed by this application.
      </p>
      {page === null ? (
        <p role="alert" className="error">
          Could not load the evidence from the API. Try again shortly.
        </p>
      ) : page.items.length === 0 ? (
        <p>{cursor ? "No more evidence." : "No evidence yet."}</p>
      ) : (
        <ul className="evidence-list">
          {page.items.map((item) => (
            <EvidenceRow key={item.linkId} item={item} />
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <p>
          <Link
            href={`${here}?cursor=${encodeURIComponent(page.nextCursor)}`}
            rel="next"
          >
            Load more
          </Link>
        </p>
      )}
      {cursor && (
        <p>
          <Link href={here}>Back to the first page</Link>
        </p>
      )}
      {canWrite && (
        <>
          <h3 id="add-evidence-heading">Add evidence</h3>
          <AddEvidenceForm
            action={addEvidenceAction.bind(null, tenantId, target, targetId)}
            formId={formId}
          />
        </>
      )}
    </section>
  );
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  return (
    <li className="evidence-item">
      <dl>
        <dt>Kind</dt>
        <dd>{KIND_LABELS[item.kind]}</dd>
        <dt>Provider</dt>
        <dd>{item.provider}</dd>
        <dt>Retrieved</dt>
        <dd>{moment(item.retrievedAt)}</dd>
        {item.publishedAt && (
          <>
            <dt>Published</dt>
            <dd>{day(item.publishedAt)}</dd>
          </>
        )}
        <dt>Added by</dt>
        <dd>{item.createdVia}</dd>
        {item.url && (
          <>
            <dt>URL</dt>
            <dd className="plain-text" data-evidence="url">
              {item.url}
            </dd>
          </>
        )}
        {item.reference && (
          <>
            <dt>Reference</dt>
            <dd className="plain-text" data-evidence="reference">
              {item.reference}
            </dd>
          </>
        )}
        {item.snippet && (
          <>
            <dt>Snippet</dt>
            <dd className="plain-text" data-evidence="snippet">
              {item.snippet}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
