"use client";

import { Building2, Dumbbell, Ellipsis, GraduationCap, HeartPulse, IndianRupee, MonitorSmartphone, ShoppingBag, UtensilsCrossed, Wrench, type LucideIcon } from "lucide-react";
import * as React from "react";

import { closest } from "@/lib/packs/match";

import { OTHER_MAX, OTHER_MIN, type TypeGroup, type TypeOption, type TypeWords } from "./TypeCombobox";
import { authField, authHint, authLabel } from "./ui";

/** The line icon of a group, by the group's id from the API's groups file (data, not a business type); a group with no icon here gets the dots. */
const ICONS: Readonly<Record<string, LucideIcon>> = { retail: ShoppingBag, food: UtensilsCrossed, services: Wrench, health: HeartPulse, education: GraduationCap, property: Building2, money: IndianRupee, digital: MonitorSmartphone, fitness: Dumbbell };
const COLOURS: Readonly<Record<string, string>> = { call: "text-[color:var(--k-call)]", chat: "text-[color:var(--k-chat)]", visit: "text-[color:var(--k-visit)]", offer: "text-[color:var(--k-offer)]", find: "text-[color:var(--k-find)]" };

/**
 * The business type as a grid of boxed tiles in groups (owner, 29 Nov 2026: 54 types): a search box that filters the tiles as you type, one tile per type (its name and one line; one border, light radius, the chosen one outlined in ink),
 * each group with its line icon in the group's colour. "Describe what you sell" takes a few words in any language and suggests the closest type; the person confirms with "Use this". "Something else" (`otherId`) shows the one
 * required text field. The choice goes with the form as the hidden field `name`; `onChoose` runs when a choice is made (the sign-up goes on to step 2 at once).
 */
export function TypeTiles({ groups, words, name = "type", otherId = null, askOther = true, initial = null, otherInitial = "", onChoose }: { groups: readonly TypeGroup[]; words: TypeWords; name?: string; otherId?: string | null; askOther?: boolean; initial?: string | null; otherInitial?: string; onChoose?: (id: string) => void }) {
  const uid = React.useId();
  const all = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const [chosen, setChosen] = React.useState<string | null>(initial && all.some((o) => o.id === initial) ? initial : null);
  const [query, setQuery] = React.useState("");
  const [described, setDescribed] = React.useState("");
  const [suggest, setSuggest] = React.useState<{ option: TypeOption | null } | null>(null);
  const [otherText, setOtherText] = React.useState(otherInitial);
  const text = query.trim().toLowerCase();
  const shown = React.useMemo(
    () => groups.map((g) => ({ ...g, options: g.options.filter((o) => text === "" || o.name.toLowerCase().includes(text) || o.tagline.toLowerCase().includes(text) || (o.keywords ?? "").toLowerCase().includes(text)) })).filter((g) => g.options.length > 0),
    [groups, text],
  );
  const choose = (id: string) => {
    setChosen(id);
    setSuggest(null);
    if (id !== otherId || !askOther) onChoose?.(id);
  };
  const find = () => setSuggest({ option: closest(described, all.filter((o) => o.id !== otherId)) });
  const other = otherId !== null ? all.find((o) => o.id === otherId) : undefined;
  return (
    <div data-part="type-tiles" className="flex flex-col gap-4">
      <div className="flex flex-col">
        <label htmlFor={`${uid}-search`} className={authLabel}>
          {words.label}
        </label>
        <input id={`${uid}-search`} type="search" value={query} placeholder={words.placeholder} autoComplete="off" onChange={(e) => setQuery(e.target.value)} className={authField} />
      </div>
      {shown.length === 0 ? (
        <p role="status" className="m-0 text-base text-muted">
          {words.none}
        </p>
      ) : (
        shown.map((g) => {
          const Icon = (g.icon ? ICONS[g.icon] : undefined) ?? Ellipsis;
          const colour = (g.colour && COLOURS[g.colour]) || "";
          return (
            <section key={g.key} aria-labelledby={`${uid}-g-${g.key}`} data-group={g.key}>
              <h3 id={`${uid}-g-${g.key}`} className="m-0 mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
                <Icon className={`size-5 shrink-0 ${colour}`} aria-hidden="true" />
                {g.label}
              </h3>
              <div role="radiogroup" aria-labelledby={`${uid}-g-${g.key}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={o.id === chosen}
                    data-pack-card={o.id}
                    onClick={() => choose(o.id)}
                    className={`flex min-h-[88px] flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-surface-2 ${o.id === chosen ? "border-ink shadow-[inset_0_0_0_1px_var(--v2-ink,currentColor)]" : "border-edge"}`}
                  >
                    <span className="text-[15px] font-semibold leading-tight text-ink">{o.name}</span>
                    {o.tagline ? <span className="line-clamp-2 text-[13px] leading-snug text-muted">{o.tagline}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}
      {words.describeLabel ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4" data-part="describe">
          <label htmlFor={`${uid}-describe`} className={authLabel}>
            {words.describeLabel}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={`${uid}-describe`}
              type="text"
              value={described}
              maxLength={160}
              autoComplete="off"
              onChange={(e) => {
                setDescribed(e.target.value);
                setSuggest(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  find();
                }
              }}
              className={`${authField} sm:flex-1`}
            />
            <button type="button" onClick={find} disabled={described.trim() === ""} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-edge px-4 text-base font-semibold text-ink hover:bg-surface-2 disabled:opacity-50">
              {words.describeButton}
            </button>
          </div>
          <p className={authHint}>{words.describeHint}</p>
          {suggest ? (
            <div role="status" data-part="suggestion" className="flex flex-wrap items-center gap-3 border-y border-line py-3 text-base">
              {suggest.option ? (
                <>
                  <span className="text-ink">
                    {words.describeClosest}: <b>{suggest.option.name}</b>
                  </span>
                  <button type="button" onClick={() => choose(suggest.option!.id)} className="inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-sm font-semibold text-surface">
                    {words.describeUse}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-muted">{words.describeNone}</span>
                  {other ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOtherText(described.trim().slice(0, OTHER_MAX));
                        choose(other.id);
                      }}
                      className="inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-sm font-semibold text-ink hover:bg-surface-2"
                    >
                      {other.name}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <input type="hidden" name={name} value={chosen ?? ""} />
      {otherId !== null && askOther && chosen === otherId ? (
        <div className="flex flex-col" data-part="other-label">
          <label htmlFor={`${uid}-other`} className={authLabel}>
            {words.otherAsk}
          </label>
          <input id={`${uid}-other`} name="other_label" type="text" value={otherText} onChange={(e) => setOtherText(e.target.value)} required minLength={OTHER_MIN} maxLength={OTHER_MAX} autoComplete="off" className={authField} />
          <p className={authHint}>{words.otherHint}</p>
        </div>
      ) : null}
    </div>
  );
}
