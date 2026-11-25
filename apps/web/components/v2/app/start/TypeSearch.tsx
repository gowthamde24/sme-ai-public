"use client";

import * as React from "react";

import { LONG_LIST, searchTypes, type TypeRow } from "@/lib/packs/type-search";

import { fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { TYPE_TILE } from "./tile";

/**
 * The business-type tiles with a search box (owner, 26 Nov 2026), the ONE component of the first-login page and of "Add a workspace". Typing filters the tiles as you type and puts the matches first (name, one line, synonyms, the name in other
 * languages); with a long list the rest sits behind "Show all types". Enter chooses the only match. No match: one plain line and a button for "Other". The tiles keep their flat style. Radios inside, so it also works inside a form (`name`, `required`).
 */
export function TypeSearch({ choices, words, name = "start-type", value, onPick, disabled = false, required = false, otherId = "other" }: { choices: readonly TypeRow[]; words?: Words; name?: string; /** the chosen type when the parent keeps it; omit and the component keeps it itself */ value?: string | null; onPick?: (id: string) => void; disabled?: boolean; required?: boolean; otherId?: string | null }) {
  const t = makeT(words);
  const uid = React.useId();
  const [query, setQuery] = React.useState("");
  const [own, setOwn] = React.useState<string | null>(null);
  const [all, setAll] = React.useState(false);
  const chosen = value !== undefined ? value : own;
  const { matches, rest, searching } = React.useMemo(() => searchTypes(choices, query), [choices, query]);
  const long = choices.length > LONG_LIST;
  const pick = (id: string) => {
    setOwn(id);
    onPick?.(id);
  };
  // the chosen tile stays on screen even when a search would hide it
  const hiddenRest = searching && long && !all;
  const shownRest = hiddenRest ? rest.filter((r) => r.id === chosen) : rest;
  const tiles = [...matches, ...shownRest];
  const other = otherId ? choices.find((c) => c.id === otherId) : undefined;
  return (
    <div data-part="type-search" className="flex flex-col gap-3">
      <div className="flex flex-col">
        <label htmlFor={`${uid}-q`} className={fieldLabel}>
          {t("start.type.q")}
        </label>
        <input
          id={`${uid}-q`}
          type="search"
          value={query}
          placeholder={t("start.type.q.ph")}
          autoComplete="off"
          disabled={disabled}
          onChange={(e) => (setQuery(e.target.value), setAll(false))}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault(); // never sends the form
            if (searching && matches.length === 1) pick(matches[0].id);
          }}
          className="min-h-12 w-full rounded-lg border border-edge bg-surface px-3 text-base text-ink"
        />
      </div>
      {searching && matches.length === 0 ? (
        <div role="status" data-part="type-none" className="flex flex-wrap items-center gap-3 text-[15px]">
          <span className="text-muted">{t("start.type.q.none")}</span>
          {other ? (
            <button type="button" disabled={disabled} onClick={() => pick(other.id)} className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-sm font-semibold text-ink hover:bg-surface-2">
              {t("start.type.q.other", { name: other.name })}
            </button>
          ) : null}
        </div>
      ) : searching ? (
        <p role="status" className="sr-only" data-part="type-count">
          {t("start.type.q.count", { n: matches.length })}
        </p>
      ) : null}
      <div role="radiogroup" aria-label={t("start.type.title")} className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {tiles.map((c) => (
          <label key={c.id} data-type={c.id} data-picked={chosen === c.id ? "" : undefined} data-match={searching && matches.includes(c) ? "" : undefined} className={TYPE_TILE}>
            <input type="radio" name={name} value={c.id} checked={chosen === c.id} required={required} disabled={disabled} onChange={() => pick(c.id)} className="sr-only" />
            <span className="block text-[16px] font-semibold text-ink">{c.name}</span>
            {c.line ? <span className="block text-sm text-muted">{c.line}</span> : null}
          </label>
        ))}
      </div>
      {searching && long && rest.length > 0 ? (
        <p className="m-0">
          <button type="button" data-part="type-all" aria-expanded={all} onClick={() => setAll((x) => !x)} className="min-h-11 text-[15px] text-muted underline underline-offset-4">
            {all ? t("start.type.q.less") : t("start.type.q.all")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
