import { callsHref } from "@/lib/calls/filter";
import { periodHref } from "@/lib/reports-v6/period";

import { PATH, RECORD_PATH, type ClientAction } from "./registry";

/** The addresses of the actions (kept apart from the registry: the card that runs them loads with the chat's work cards, while parsing a card must stay tiny, because every page's first load parses the chat's events). */
/** Where a navigating action goes (`base` = `/app/tenants/<id>`), or null for an action that goes nowhere (theme, language, Talk live). */
export function hrefOf(a: ClientAction, base: string): string | null {
  switch (a.action) {
    case "navigate":
      if (a.page === "reports" && a.period) return a.period.key === "custom" ? periodHref(base, "custom", { from: a.period.from, to: a.period.to }) : periodHref(base, a.period.key);
      return `${base}${PATH[a.page]}${a.card ? `?card=${a.card}` : ""}`;
    case "open_record":
      return `${base}${RECORD_PATH[a.type]}/${a.id}`;
    case "filter":
      return callsHref(base, { status: a.status, when: a.when, line: null, q: a.q });
    case "open_settings":
      return `${base}/settings?section=${a.section}`;
    default:
      return null;
  }
}
