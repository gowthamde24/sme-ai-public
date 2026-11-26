"use client";

import * as React from "react";

import { CALL_LANG_NAMES, type CallLang } from "@/lib/assistant/types";
import type { ActivityCall, Refusal } from "@/lib/employees/types";

import { btnQuiet, pillNeutral } from "../../ui";
import { labelOr, makeT } from "../../words";
import { Card, type TabProps } from "./shared";

/** The action loads 30 at a time: a full page means there may be more. */
const PAGE = 30;
const LOCALES: Record<string, string> = { te: "te-IN", hi: "hi-IN", kn: "kn-IN", en: "en-IN" };

/** Activity: the calls this employee took, newest first; "Show more" asks for the ones before the last one shown. */
export function ActivityTab({ words, actions, lang }: TabProps & { lang: string }) {
  const t = makeT(words);
  const [rows, setRows] = React.useState<readonly ActivityCall[]>([]);
  const [more, setMore] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<Refusal | null>(null);
  const started = React.useRef(false);

  const load = React.useCallback(
    async (before?: string) => {
      setBusy(true);
      setError(null);
      try {
        const out = await actions.activity(before);
        if (out.ok) {
          setRows((r) => (before ? [...r, ...out.data] : out.data));
          setMore(out.data.length >= PAGE);
        } else setError(out.error);
      } catch {
        setError("unavailable");
      } finally {
        setBusy(false);
        setLoaded(true);
      }
    },
    [actions],
  );
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const when = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(LOCALES[lang] ?? "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);
  };
  const length = (s: number | null): string => (s === null ? "" : s < 60 ? t("emp.page.act.sec", { s }) : t("emp.page.act.min", { m: Math.floor(s / 60), s: s % 60 }));

  return (
    <Card title={t("emp.page.act")} desc={t("emp.page.act_help")}>
      {!loaded && busy ? (
        <p role="status" className="m-0 text-[15px] text-muted">
          {t("emp.page.loading")}
        </p>
      ) : null}
      {loaded && rows.length === 0 && !error ? (
        <p data-part="emp-act-empty" className="m-0 text-base text-ink">
          {t("emp.page.act.empty")}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-line rounded-xl border border-line p-0" data-part="emp-act-list">
          {rows.map((c) => (
            <li key={c.id} data-call={c.id} className="flex flex-col gap-1 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-ink">{when(c.createdAt)}</span>
                <span className={pillNeutral}>{t(c.direction === "outbound" ? "emp.page.act.out" : "emp.page.act.in")}</span>
              </div>
              <p className="m-0 text-[15px] text-muted">
                {[c.outcome ? labelOr(t, `outcome.cat.${c.outcome}`, "emp.page.act.no_result") : t("emp.page.act.no_result"), c.language ? (CALL_LANG_NAMES[c.language as CallLang] ?? c.language) : "", length(c.durationS)].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-red-text bg-red-bg p-3 font-medium text-red-text">
          {t(`emp.err.${error}`)}
        </p>
      ) : null}
      {more && rows.length > 0 ? (
        <div>
          <button type="button" disabled={busy} onClick={() => void load(rows[rows.length - 1]?.createdAt)} data-part="emp-act-more" className={btnQuiet}>
            {t("emp.page.act.more")}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
