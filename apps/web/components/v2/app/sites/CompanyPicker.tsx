"use client";

import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { field, help, label, secondary } from "../visits/styles";

export type CompanyChoice = { id: string; name: string; city: string | null };

/**
 * Find a customer by name (jobs CO, CQ, CS): type two letters, press Search, pick one. Controlled: the form holds the choice. The search itself is the page's server action, so the browser never holds a token. A customer
 * already chosen (a link from the customer's page) is shown with a "Change" button.
 */
export function CompanyPicker({ value, onChange, search, words, disabled = false, idPrefix = "cp" }: { value: CompanyChoice | null; onChange: (c: CompanyChoice | null) => void; search: (q: string) => Promise<CompanyChoice[]>; words: TodayWords; disabled?: boolean; idPrefix?: string }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<CompanyChoice[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (value)
    return (
      <div data-part="company-picked" className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
        <span className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">
          {value.name}
          {value.city ? <span className="font-normal text-muted"> · {value.city}</span> : null}
        </span>
        {disabled ? null : (
          <button type="button" className={secondary} onClick={() => { onChange(null); setHits(null); }}>
            {say(words, "site.pick.change")}
          </button>
        )}
      </div>
    );
  async function run() {
    setBusy(true);
    try {
      setHits(await search(q));
    } catch {
      setHits([]);
    }
    setBusy(false);
  }
  return (
    <div data-part="company-picker" className="flex flex-col gap-2">
      <label htmlFor={`${idPrefix}-q`} className={label}>
        {say(words, "site.pick.label")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input id={`${idPrefix}-q`} value={q} maxLength={100} disabled={disabled || busy} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }} className={`${field} min-w-48 flex-1`} aria-describedby={`${idPrefix}-help`} />
        <button type="button" disabled={disabled || busy} className={secondary} onClick={() => void run()}>
          {say(words, "site.pick.search")}
        </button>
      </div>
      <p id={`${idPrefix}-help`} className={help}>
        {say(words, "site.pick.help")}
      </p>
      {hits === null ? null : hits.length === 0 ? (
        <p role="status" className="text-sm text-muted">{say(words, "site.pick.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-edge px-3 text-left text-base hover:bg-surface-2" onClick={() => onChange(h)}>
                <span className="font-semibold [overflow-wrap:anywhere]">{h.name}</span>
                <span className="text-sm text-muted">{h.city ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
