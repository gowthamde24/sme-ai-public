import Link from "next/link";

import type { Part } from "@/lib/assistant-status/types";

import { makeT, type Words } from "../words";
import { SectionSelect } from "./SectionSelect";
import { SECTIONS, tabHref, tabUsesDefaults, type Section } from "./tabs";

/**
 * The sections of Train how it talks (owner, 18 Nov 2026): Knowledge, Voice & tone, Rules and Practice. A list on the left from 1024 px wide; on a phone ONE select (a list of four rows would push the page down). Each is a plain link to its own address
 * (`?section=`), so only that section's data is read; the one that is open says "Using defaults" under its name while its part runs on defaults.
 */
export function TrainSections({ words, base, current, usingDefaults }: { words?: Words; base: string; current: Section; usingDefaults: readonly Part[] }) {
  const t = makeT(words);
  const items = SECTIONS.map((s) => ({ key: s, label: t(`mya.tab.${s}` as "mya.tab.knowledge"), href: tabHref(base, s), defaults: tabUsesDefaults(s, usingDefaults) }));
  return (
    <>
      <nav aria-label={t("mya.sections.label")} data-part="train-sections" className="hidden lg:block">
        <ul className="m-0 flex list-none flex-col gap-1 border-b border-line p-0 lg:border-b-0 lg:border-r lg:pr-3">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} aria-current={i.key === current ? "page" : undefined} data-section={i.key} className={`flex min-h-11 flex-col justify-center rounded-lg px-3 py-1.5 text-base font-semibold ${i.key === current ? "bg-surface-2 text-brand-text" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                {i.label}
                {i.defaults && i.key === current ? (
                  <span data-part="mya-defaults" className="text-xs font-medium text-muted">
                    {t("mya.defaults")}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="lg:hidden" data-part="train-section-select">
        <SectionSelect label={t("mya.sections.label")} current={current} options={items.map((i) => ({ key: i.key, label: i.label, href: i.href }))} />
        {items.find((i) => i.key === current)?.defaults ? (
          <p data-part="mya-defaults" className="m-0 mt-1 text-xs font-medium text-muted">
            {t("mya.defaults")}
          </p>
        ) : null}
      </div>
    </>
  );
}
