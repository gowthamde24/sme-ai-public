import type { Lang } from "@/i18n/lang";
import { legalT } from "@/i18n/legal";
import type { Subprocessors } from "@/lib/dpdp/types";
import { ADDRESSES } from "@/lib/site/business";

import { updatedOn } from "./LegalDoc";

/**
 * The companies that process personal data for us, in the Privacy notice (job DQ part 2): read from the API (`GET /v1/privacy/subprocessors`, contract-dpdp.md) when the page is drawn, so the notice can never name a company the service does not use
 * or leave out one it does. The names, purposes, countries and data are the API's own words (English); the headings are ours. When the list cannot be read the page says so and gives the address to ask: it never guesses a list.
 */
export function SubprocessorList({ data, lang }: { data: Subprocessors | null; lang: Lang }) {
  const t = legalT(lang);
  if (!data || data.items.length === 0)
    return (
      <p data-legal="subprocessors-missing" lang={lang} className="mt-3 rounded-lg border border-line bg-surface-2 px-4 py-3 text-base">
        {t("legal.sp.none", { privacy_email: ADDRESSES.privacy })}
      </p>
    );
  return (
    <div data-legal="subprocessors">
      <div role="region" aria-label={t("legal.sp.caption")} tabIndex={0} className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] border-collapse text-left text-base">
          <caption className="sr-only">{t("legal.sp.caption")}</caption>
          <thead className="bg-surface-2">
            <tr>
              {(["name", "purpose", "country", "data"] as const).map((k) => (
                <th key={k} scope="col" lang={lang} className="px-3 py-2 font-semibold">
                  {t(`legal.sp.${k}` as "legal.sp.name")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody lang="en">
            {data.items.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-2 font-semibold">
                  {p.link ? (
                    <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-brand-text underline underline-offset-2">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </th>
                <td className="px-3 py-2">{p.purpose}</td>
                <td className="px-3 py-2">{p.country}</td>
                <td className="px-3 py-2">{p.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p lang={lang} className="mt-2 text-sm text-muted">
        {t("legal.sp.version", { version: data.version, date: /^\d{4}-\d{2}-\d{2}$/.test(data.updatedOn) ? updatedOn(data.updatedOn, lang) : data.updatedOn })}
      </p>
    </div>
  );
}
