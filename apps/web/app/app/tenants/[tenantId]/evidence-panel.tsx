import Link from "next/link";
import { indiaDayText } from "@/components/v2/app/visits/dates";

import { type EvidenceItem, type EvidencePage, type EvidenceTarget, referenceText } from "@/lib/api/evidence";

import { LocalTime } from "../../local-time";
import { AddEvidenceForm } from "./add-evidence-form";
import { addEvidenceAction } from "./evidence-actions";
import { alertBox, bodyText, kvList, link, listItemCard, listPlain, mutedText, pageH2, pageH3, plainText, spaceTop } from "@/components/v2/app/ui";
import { makeT, type Words } from "@/components/v2/app/words";

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
  formId: string; words?: Words;
};

function day(iso: string): string {
  return indiaDayText(iso);
}

export function EvidencePanel({
  tenantId,
  target,
  targetId,
  page,
  cursor,
  canWrite,
  formId, words,
}: Props) {
  const t = makeT(words);
  const here = `/app/tenants/${tenantId}/${target}/${targetId}`;
  return (
    <section aria-labelledby="evidence-heading">
      <h2 id="evidence-heading" className={pageH2}>
        {t("ws.evidence")}
      </h2>
      <p className={mutedText}>
        {t("ws.sources_are_shown_as_plain_text")}
      </p>
      {page === null ? (
        <p role="alert" className={alertBox}>
          {t("ws.could_not_load_the_evidence_from")}
        </p>
      ) : page.items.length === 0 ? (
        <p className={bodyText}>{cursor ? t("ws.no_more_evidence") : t("ws.no_evidence_yet")}</p>
      ) : (
        <ul className={listPlain}>
          {page.items.map((item) => (
            <EvidenceRow words={words} key={item.linkId} item={item} />
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
            {t("ws.load_more")}
          </Link>
        </p>
      )}
      {cursor && (
        <p>
          <Link href={here} className={link}>
            {t("ws.back_to_the_first_page")}
          </Link>
        </p>
      )}
      {canWrite && (
        <>
          <h3 id="add-evidence-heading" className={pageH3}>
            {t("ws.add_evidence")}
          </h3>
          <AddEvidenceForm words={words}
            action={addEvidenceAction.bind(null, tenantId, target, targetId)}
            formId={formId}
          />
        </>
      )}
    </section>
  );
}

function EvidenceRow({ item, words }: { item: EvidenceItem; words?: Words; }) {
  const t = makeT(words);
  return (
    <li className={listItemCard}>
      <dl className={kvList}>
        <dt>{t("ws.kind")}</dt>
        <dd>{t(`ws.evkind.${item.kind}`)}</dd>
        <dt>{t("ws.provider")}</dt>
        <dd>{item.provider}</dd>
        <dt>{t("ws.retrieved")}</dt>
        <dd>
          <LocalTime iso={item.retrievedAt} />
        </dd>
        {item.publishedAt && (
          <>
            <dt>{t("ws.published")}</dt>
            <dd>{day(item.publishedAt)}</dd>
          </>
        )}
        <dt>{t("ws.added_by")}</dt>
        <dd>{item.createdVia}</dd>
        {item.url && (
          <>
            <dt>{t("ws.url")}</dt>
            <dd className={plainText} data-evidence="url">
              {item.url}
            </dd>
          </>
        )}
        {item.reference && (
          <>
            <dt>{t("ws.reference")}</dt>
            <dd className={plainText} data-evidence="reference">
              {referenceText(item)}
            </dd>
          </>
        )}
        {item.snippet && (
          <>
            <dt>{t("ws.snippet")}</dt>
            <dd className={plainText} data-evidence="snippet">
              {item.snippet}
            </dd>
          </>
        )}
      </dl>
    </li>
  );
}
