import Link from "next/link";

import { GUIDE_IDS } from "@/lib/lead-desk/guides";

import { makeT, type Words } from "../words";

/** "Guides for each source" (mock "Lead sources"): one boxed card for each way leads reach Stack19 (a thing you open), each opening its step-by-step guide page. */
export function GuideCards({ words, base }: { words: Words; base: string }) {
  const t = makeT(words);
  return (
    <section data-part="lead-guides" aria-labelledby="lsg-h" className="flex flex-col gap-2">
      <h2 id="lsg-h" className="m-0 font-display text-xl font-semibold">
        {t("lsg.title")}
      </h2>
      <p className="m-0 text-[15px] text-muted">{t("lsg.works")}</p>
      <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {GUIDE_IDS.map((g) => (
          <li key={g}>
            <Link href={`${base}/lead-sources/guides/${g}`} data-guide={g} className="flex min-h-[116px] flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-[18px] no-underline hover:border-ink focus-visible:border-ink">
              <b className="text-[17px] font-bold text-ink">{t(`lsg.${g}.t` as "lsg.fb.t")}</b>
              <span className="text-[15px] text-muted">{t(`lsg.${g}.x` as "lsg.fb.x")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
