"use client";

import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { authField, authHint, authLabel } from "./ui";

export type TypeOption = { id: string; name: string; tagline: string };
export type TypeGroup = { key: string; label: string; options: readonly TypeOption[] };
export type TypeWords = Readonly<Record<"label" | "placeholder" | "none" | "otherAsk" | "otherHint", string>>;

/** 2 to 60 letters, as the free text of "Other" must be (the same rule the API applies). */
export const OTHER_MIN = 2;
export const OTHER_MAX = 60;

/**
 * The business type, as ONE searchable list (first-run fixes): a text box that filters the list as you type, the list grouped ("Built especially for", "Lead Desk", "Other"), one choice, phone friendly (big rows, the list is in the page, not a pop-up
 * that hides behind the keyboard). Keyboard: arrows move, Enter chooses, Esc closes. The choice goes with the form as the hidden field `name`; "Other" (`otherId`) shows a required text field "What is your business?" (`other_label`, 2 to 60 letters).
 * `onChoose` runs when a choice is made (the sign-up goes on to step 2 at once); with `askOther` the "Other" choice only shows its text field (the form that holds it checks the text). Each row carries `data-pack-card` with its id, as the cards did.
 */
export function TypeCombobox({ groups, words, name = "type", otherId = null, askOther = true, initial = null, onChoose }: { groups: readonly TypeGroup[]; words: TypeWords; name?: string; otherId?: string | null; /** Show the text field "What is your business?" when Other is chosen (the first-login setup); false = Other is a choice like any other (sign-up step 1: the words are asked at setup). */ askOther?: boolean; initial?: string | null; onChoose?: (id: string) => void }) {
  const uid = React.useId();
  const all = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const [chosen, setChosen] = React.useState<string | null>(initial && all.some((o) => o.id === initial) ? initial : null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const text = query.trim().toLowerCase();
  const shown = React.useMemo(() => groups.map((g) => ({ ...g, options: g.options.filter((o) => text === "" || o.name.toLowerCase().includes(text) || o.tagline.toLowerCase().includes(text) || (otherId !== null && o.id === otherId && "other".includes(text))) })).filter((g) => g.options.length > 0), [groups, text, otherId]);
  const flat = shown.flatMap((g) => g.options);
  const chosenName = all.find((o) => o.id === chosen)?.name ?? "";
  const listId = `${uid}-list`;
  const optionId = (id: string) => `${uid}-opt-${id}`;
  const choose = (id: string) => {
    setChosen(id);
    setQuery("");
    setOpen(false);
    if (id !== otherId || !askOther) onChoose?.(id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), Math.max(flat.length - 1, 0)));
    } else if (e.key === "Enter" && open && flat[active]) {
      e.preventDefault();
      choose(flat[active].id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return (
    <div data-part="type-combobox" className="flex flex-col">
      <label htmlFor={`${uid}-input`} className={authLabel}>
        {words.label}
      </label>
      <div className="relative">
        <input
          id={`${uid}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? optionId(flat[active].id) : undefined}
          autoComplete="off"
          value={open || chosen === null ? query : chosenName}
          placeholder={chosen === null || open ? words.placeholder : chosenName}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          className={`${authField} pr-11`}
        />
        <button type="button" tabIndex={-1} aria-label={words.label} onClick={() => setOpen((v) => !v)} className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted">
          <ChevronDown className="size-5" aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div id={listId} role="listbox" aria-label={words.label} className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-edge bg-surface p-1">
          {flat.length === 0 ? (
            <p className="px-3 py-3 text-base text-muted">{words.none}</p>
          ) : (
            shown.map((g) => (
              <div key={g.key} role="group" aria-labelledby={`${uid}-g-${g.key}`}>
                <p id={`${uid}-g-${g.key}`} className="px-3 pb-1 pt-3 text-sm font-semibold text-muted">
                  {g.label}
                </p>
                {g.options.map((o) => (
                  <div
                    key={o.id}
                    id={optionId(o.id)}
                    role="option"
                    aria-selected={o.id === chosen}
                    data-pack-card={o.id}
                    data-active={flat[active]?.id === o.id ? "true" : undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(o.id)}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-2 data-[active=true]:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold leading-tight">{o.name}</span>
                      {o.tagline ? <span className="block text-sm text-muted">{o.tagline}</span> : null}
                    </span>
                    {o.id === chosen ? <Check className="size-5 shrink-0 text-brand-text" aria-hidden="true" /> : null}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
      <input type="hidden" name={name} value={chosen ?? ""} />
      {otherId !== null && askOther && chosen === otherId ? (
        <div className="flex flex-col" data-part="other-label">
          <label htmlFor={`${uid}-other`} className={authLabel}>
            {words.otherAsk}
          </label>
          <input id={`${uid}-other`} name="other_label" type="text" required minLength={OTHER_MIN} maxLength={OTHER_MAX} autoComplete="off" className={authField} />
          <p className={authHint}>{words.otherHint}</p>
        </div>
      ) : null}
    </div>
  );
}
