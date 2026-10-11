import type { ReactNode } from "react";

import { BRAND_TEXT } from "@/design/brand";
import type { Lang } from "@/i18n/lang";
import { legalT } from "@/i18n/legal";
import { LEGAL_IS_DRAFT, LEGAL_VERSION } from "@/lib/legal/version";
import { PLACEHOLDER, type Block, type LegalText } from "@/lib/legal/types";

/** A text with {brand} filled and every [PLACEHOLDER] drawn highlighted (the owner must fill them; none may be missed). */
export function Rich({ text }: { text: string }): ReactNode {
  const filled = text.replaceAll("{brand}", BRAND_TEXT);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of filled.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(filled.slice(last, at));
    parts.push(
      <mark key={at} data-placeholder="" className="rounded bg-amber-bg px-1 font-semibold text-amber-text">
        {m[0]}
      </mark>,
    );
    last = at + m[0].length;
  }
  if (last < filled.length) parts.push(filled.slice(last));
  return parts;
}

function BlockView({ block, label }: { block: Block; label: string }) {
  if ("p" in block) return <p className="mt-3 text-base leading-relaxed">{<Rich text={block.p} />}</p>;
  if ("ul" in block)
    return (
      <ul className="mt-3 list-disc space-y-2 pl-6 text-base leading-relaxed">
        {block.ul.map((li) => (
          <li key={li}>
            <Rich text={li} />
          </li>
        ))}
      </ul>
    );
  return (
    <div role="region" aria-label={label} tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[34rem] border-collapse text-left text-base">
        <thead className="bg-surface-2">
          <tr>
            {block.table.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((row) => (
            <tr key={row[0]} className="border-t border-line align-top">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-2 font-semibold">
                    <Rich text={cell} />
                  </th>
                ) : (
                  <td key={i} className="px-3 py-2">
                    <Rich text={cell} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A legal page: the title, the version and effective date, the "Draft, pending legal review" banner (while LEGAL_IS_DRAFT), a short plain-language summary in the visitor's language (a machine draft, said so),
 * and the full English text. The English text is never translated by machine; it carries lang="en" inside a page in another language.
 */
export function LegalDoc({ doc, summaryKeys, lang }: { doc: LegalText; summaryKeys: readonly ("legal.sum.privacy.1" | "legal.sum.privacy.2" | "legal.sum.privacy.3" | "legal.sum.privacy.4" | "legal.sum.privacy.5" | "legal.sum.terms.1" | "legal.sum.terms.2" | "legal.sum.terms.3" | "legal.sum.terms.4")[]; lang: Lang }) {
  const t = legalT(lang);
  return (
    <article>
      {LEGAL_IS_DRAFT ? (
        <div role="note" data-legal="draft-banner" lang="en" className="mb-6 rounded-lg border border-edge bg-amber-bg px-4 py-3 text-base font-semibold text-amber-text">
          {legalT("en")("legal.draft.banner")}
        </div>
      ) : null}
      <h1 lang="en" className="font-display text-3xl font-bold leading-tight sm:text-4xl">
        {doc.title}
      </h1>
      <p lang="en" className="mt-2 text-sm text-muted">
        {t("legal.version", { version: LEGAL_VERSION })} · <Rich text="[EFFECTIVE DATE]" />
      </p>

      <section aria-labelledby="summary-h" lang={lang} className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 id="summary-h" className="text-xl font-semibold">
          {t("legal.summary.title")}
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-6 text-base leading-relaxed">
          {summaryKeys.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        {lang !== "en" ? <p className="mt-3 text-sm text-muted">{t("legal.summary.note")}</p> : null}
      </section>

      <div lang="en">
        {doc.intro.map((p) => (
          <p key={p} className="mt-6 text-base leading-relaxed">
            <Rich text={p} />
          </p>
        ))}
      </div>

      <nav aria-label={t("legal.toc")} lang={lang} className="mt-6">
        <h2 className="text-base font-semibold">{t("legal.toc")}</h2>
        <ol lang="en" className="mt-1 flex flex-wrap gap-x-4">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-11 items-center text-base font-medium text-brand-text hover:underline">
                <Rich text={s.title.replace(/^\d+\.\s*/, "")} />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div lang="en">
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-8 scroll-mt-20">
            <h2 id={`${s.id}-h`} className="font-display text-2xl font-bold leading-snug">
              <Rich text={s.title} />
            </h2>
            {s.blocks.map((b, i) => (
              <BlockView key={i} block={b} label={s.title.replace(/^\d+\.\s*/, "")} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
