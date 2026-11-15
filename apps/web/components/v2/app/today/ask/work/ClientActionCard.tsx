"use client";

import { Check } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { hrefOf } from "@/lib/client-actions/href";
import { stashNote } from "@/lib/client-actions/note";
import { runClientAction, type Ran } from "@/lib/client-actions/run";
import type { ClientActionCard as Card } from "@/lib/assistant-work/types";

import { setTalking } from "../../v6/v6-state";
import { btnSmall, type WorkEnv } from "./work-env";

/** What already ran in this browser session, by card id: a card that is drawn again (the thread came back, the person went to another page and returned) shows its state and NEVER runs a second time. */
type Entry = { ran: Ran; undone: boolean };
const RAN = new Map<string, Entry>();
const subs = new Set<() => void>();
const remember = (id: string, e: Entry) => {
  RAN.set(id, e);
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

const NATIVE: Readonly<Record<string, string>> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };

/** The sentence of what was done, in the app's words. */
function said(card: Card, t: WorkEnv["t"]): string {
  const a = card.spec;
  switch (a.action) {
    case "theme":
      return t(`bv.work.ca.theme.${a.mode}`);
    case "language":
      return t("bv.work.ca.language", { name: NATIVE[a.lang] ?? a.lang });
    case "navigate": {
      const where = t(`bv.work.ca.page.${a.page}`);
      return a.period ? t("bv.work.ca.open.period", { where, period: t(`bv.work.ca.period.${a.period.key}`) }) : t("bv.work.ca.open", { where });
    }
    case "open_record":
      return t(`bv.work.ca.record.${a.type}`);
    case "filter": {
      if (a.page === "leads") {
        const w = [a.chip !== "all" ? t(`bv.work.ca.lchip.${a.chip}`) : null, a.q !== "" ? `“${a.q}”` : null].filter((x) => x !== null).join(" · ");
        return w === "" ? t("bv.work.ca.open", { where: t("bv.work.ca.page.leads") }) : t("bv.work.ca.filter", { what: w });
      }
      const what = [a.status !== "all" ? t(`bv.work.ca.status.${a.status}`) : null, a.when !== "any" ? t(`bv.work.ca.when.${a.when}`) : null, a.q !== "" ? `“${a.q}”` : null].filter((x) => x !== null).join(" · ");
      return what === "" ? t("bv.work.ca.open", { where: t("bv.work.ca.page.calls") }) : t("bv.work.ca.filter", { what });
    }
    case "open_settings":
      return t("bv.work.ca.settings");
    case "talk_live":
      return t(a.state === "start" ? "bv.work.ca.talk.start" : "bv.work.ca.talk.stop");
  }
}

/**
 * Something the assistant did in the browser, on the owner's words ("switch to dark", "open Reports for this month", "show missed calls", "start Talk live"): it runs ONCE when the card first appears, and the card says what was done with
 * "Done · Undo" (a theme or language goes back to what it was; a page or a filter it opened is left with "Back"). The registry (lib/client-actions) decides what may run; the card never runs anything else.
 */
export function ClientActionCard({ card, env }: { card: Card; env: WorkEnv }) {
  const { t } = env;
  const router = useRouter();
  const pathname = usePathname();
  const entry = React.useSyncExternalStore(subscribe, () => RAN.get(card.id), () => undefined);
  const base = env.base ?? "";
  React.useEffect(() => {
    if (card.replayed || RAN.has(card.id)) return; // a card read back from history already ran
    if (card.note && card.spec.action === "filter" && card.spec.page === "leads") stashNote("leads", card.note); // before the page opens: the Leads page takes it once
    const ran = runClientAction(card.spec, { base, pathname, push: (h) => router.push(h), refresh: () => router.refresh(), setTalking }, hrefOf);
    remember(card.id, { ran, undone: false });
    // run once per card: the deps are what the card is, not where the page is now
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);
  if (!entry && card.replayed) {
    return (
      <article data-work="client-action" data-action={card.spec.action} data-state="replayed" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2">
        <p className="m-0 flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />
          <span className="[overflow-wrap:anywhere]">{said(card, t)}</span>
          <span className="text-muted">· {t("bv.work.ca.done")}</span>
        </p>
      </article>
    );
  }
  if (!entry) return null;
  const undone = entry.undone;
  return (
    <article data-work="client-action" data-action={card.spec.action} data-state={undone ? "undone" : "done"} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface px-3 py-2">
      <p className="m-0 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <Check className="size-4 shrink-0 text-green-text" aria-hidden="true" />
        <span className="[overflow-wrap:anywhere]">{undone ? t("bv.work.ca.undone") : said(card, t)}</span>
        {!undone ? <span className="text-muted">· {t("bv.work.ca.done")}</span> : null}
      </p>
      {!undone && entry.ran.undo ? (
        <button
          type="button"
          data-work="client-undo"
          onClick={() => {
            entry.ran.undo?.();
            remember(card.id, { ran: entry.ran, undone: true });
          }}
          className={btnSmall}
        >
          {t("bv.work.ca.undo")}
        </button>
      ) : null}
      {!undone && !entry.ran.undo && entry.ran.back ? (
        <button type="button" data-work="client-back" onClick={() => router.back()} className={btnSmall}>
          {t("bv.work.ca.back")}
        </button>
      ) : null}
    </article>
  );
}
