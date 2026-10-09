import Link from "next/link";

import {
  type EvidenceItem,
  type EvidencePage,
  type EvidenceTarget,
  KIND_LABELS,
  referenceText,
} from "@/lib/api/evidence";

import { LocalTime } from "../../local-time";
import { AddEvidenceForm } from "./add-evidence-form";
import { addEvidenceAction } from "./evidence-actions";
import { alertBox, bodyText, kvList, link, listItemCard, listPlain, mutedText, pageH2, pageH3, plainText, spaceTop } from "@/components/v2/app/ui";

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
      <h2 id="evidence-heading" className={pageH2}>
        Evidence
      </h2>
      <p className={mutedText}>
        Sources are shown as plain text. They are never opened, fetched or
        previewed by this application.
      </p>
      {page === null ? (
        <p role="alert" className={alertBox}>
          Could not load the evidence from the API. Try again shortly.
        </p>
      ) : page.items.length === 0 ? (
        <p className={bodyText}>{cursor ? "No more evidence." : "No evidence yet."}</p>
      ) : (
        <ul className={listPlain}>
          {page.items.map((item) => (
            <EvidenceRow key={item.linkId} item={item} />
          ))}
        </ul>
      )}
      {page?.nextCursor && (
        <p className={spaceTop}>
          <Link
            href={`${here}?cursor=${encodeURIComponent(page.nextCursor)}`}
            rel="next"
            className={link}
          >
            Load more
          </Link>
        </p>
      )}
      {cursor && (
        <p>
          <Link href={here} className={link}>
            Back to the first page
          </Link>
        </p>
      )}
      {canWrite && (
        <>
          <h3 id="add-evidence-heading" className={pageH3}>
            Add evidence
          </h3>
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
    <li className={listItemCard}>
      <dl className={kvList}>
        <dt>Kind</dt>
        <dd>{KIND_LABELS[item.kind]}</dd>
        <dt>Provider</dt>
        <dd>{item.provider}</dd>
        <dt>Retrieved</dt>
        <dd>
          <LocalTime iso={item.retrievedAt} />
        </dd>
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
            <dd className={plainText} data-evidence="url">
              {item.url}
            </dd>
          </>
        )}
        {item.reference && (
          <>
            <dt>Reference</dt>
            <dd className={plainText} data-evidence="reference">
              {referenceText(item)}
            </dd>
          </>
        )}
        {item.snippet && (
          <>
            <dt>Snippet</dt>
            <dd className={plainText} data-evidence="snippet">
              {item.snippet}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
