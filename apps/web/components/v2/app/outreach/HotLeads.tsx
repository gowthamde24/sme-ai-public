"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import type { Done, Handoff } from "@/lib/outreach/types";

import { btnQuiet, mutedText, pillAmber, surface } from "../ui";
import { makeT, type Words } from "../words";

/**
 * "Hot leads waiting" (night 4, part A3): the people an outcome of interest was handed to a staff member for, with the one-line summary the assistant wrote and a button to say it was acted on. The Owner and Admin see every
 * one, a Sales member only their own (the API decides). A reminder that went out is said plainly.
 */
export function HotLeads({ words, items, acted }: { words: Words; items: readonly Handoff[]; acted: (id: string) => Promise<Done<true>> }) {
  const t = makeT(words);
  const router = useRouter();
  const [gone, setGone] = React.useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = React.useState(false);
  const shown = items.filter((h) => !gone.has(h.id));
  if (shown.length === 0) return <p className={`${mutedText} !mt-0`}>{t("ol.hot.none")}</p>;
  return (
    <ul data-part="hot-leads" className="flex flex-col gap-3">
      {shown.map((h) => (
        <li key={h.id} className={`${surface} flex flex-col gap-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-lg font-bold">{h.contactName}</p>
            <span className={pillAmber}>{h.reminderSentAt ? t("ol.hot.reminded") : t("ol.hot.new")}</span>
          </div>
          <p className="break-words text-base">{h.summary}</p>
          <div>
            <button
              type="button"
              className={btnQuiet}
              onClick={async () => {
                setFailed(false);
                const r = await acted(h.id).catch((): Done<true> => ({ ok: false, error: "down" }));
                if (r.ok) {
                  setGone((prev) => new Set(prev).add(h.id));
                  router.refresh();
                } else setFailed(true);
              }}
            >
              {t("ol.hot.done")}
            </button>
          </div>
        </li>
      ))}
      {failed ? (
        <li role="alert" className="text-sm font-medium text-red-text">
          {t("ol.err.control")}
        </li>
      ) : null}
    </ul>
  );
}
