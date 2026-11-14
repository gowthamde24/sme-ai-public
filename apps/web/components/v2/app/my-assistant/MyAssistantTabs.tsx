import Link from "next/link";

import type { Part } from "@/lib/assistant-status/types";

import { makeT, type Words } from "../words";
import { TABS, tabHref, tabUsesDefaults, type Tab } from "./tabs";

/**
 * The tabs of My assistant: Knowledge · Voice & tone · Rules · Practice · Go live (owner, 13 Nov 2026). Each is a link to its own address (`?tab=`), so only that tab's data is read and the page works without script; the current one is marked. A tab whose part has not been changed
 * says "Using defaults" under its name. On a phone the row scrolls sideways inside itself (the page does not).
 */
export function MyAssistantTabs({ words, base, current, usingDefaults }: { words?: Words; base: string; current: Tab; usingDefaults: readonly Part[] }) {
  const t = makeT(words);
  return (
    <nav aria-label={t("mya.tabs.label")} data-part="mya-tabs" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="m-0 flex min-w-max list-none gap-1 border-b border-line p-0">
        {TABS.map((tab) => {
          const on = tab === current;
          const defaults = tabUsesDefaults(tab, usingDefaults);
          return (
            <li key={tab}>
              <Link
                href={tabHref(base, tab)}
                aria-current={on ? "page" : undefined}
                data-tab={tab}
                className={`flex min-h-14 flex-col justify-start border-b-2 px-4 pb-1.5 pt-2.5 text-base leading-6 font-semibold ${on ? "border-brand-text text-brand-text" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t(`mya.tab.${tab}` as "mya.tab.knowledge")}
                {defaults ? (
                  <span data-part="mya-defaults" className="text-xs font-medium text-muted">
                    {t("mya.defaults")}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
