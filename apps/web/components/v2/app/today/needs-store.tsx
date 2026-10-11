"use client";

import * as React from "react";

import type { NeedsCard } from "./types";

/** A refusal kept for a card that was taken off the list while its request was out and then put back. */
export type Note = { text: string; mfa: boolean };
type Toast = { id: number; text: string };

type Store = {
  /** null = Today could not be read. */
  cards: NeedsCard[] | null;
  /** How many things wait in all: the cards, plus the ones the API counted but did not list (it lists the newest twenty). */
  total: number | null;
  /** More waiting than listed. */
  extra: number;
  notes: Readonly<Record<string, Note>>;
  toast: Toast | null;
  /** Takes a card off at once (optimistic) and returns where it was, so a refusal can put it back. */
  remove: (key: string) => number;
  restore: (card: NeedsCard, index: number, note: Note) => void;
  update: (key: string, fn: (card: NeedsCard) => NeedsCard) => void;
  clearNote: (key: string) => void;
  notify: (text: string) => void;
};

const Ctx = React.createContext<Store | null>(null);

const TOAST_MS = 6000;

/**
 * The list of "Needs you", shared by the Agent OWL card (how many things need the person), the list itself and the toast. The server hands in the cards; from then on the screen owns them: a
 * decision takes its card off at once and a refusal puts it back with the reason, so the person never waits to see the card leave and never sees one leave that was not decided.
 * `waiting` is the API's own count; when it is more than the cards listed (the API lists the newest twenty) the difference is `extra` and the count says the truth.
 */
export function NeedsProvider({ initial, waiting, children }: { initial: NeedsCard[] | null; waiting: number | null; children: React.ReactNode }) {
  const [cards, setCards] = React.useState<NeedsCard[] | null>(initial);
  const [notes, setNotes] = React.useState<Record<string, Note>>({});
  const [toast, setToast] = React.useState<Toast | null>(null);
  const extra = initial !== null && waiting !== null ? Math.max(0, waiting - initial.length) : 0;
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const store = React.useMemo<Store>(
    () => ({
      cards,
      total: cards === null ? null : cards.length + extra,
      extra,
      notes,
      toast,
      remove: (key) => {
        const index = (cards ?? []).findIndex((c) => c.key === key);
        if (index >= 0) setCards((list) => (list ?? []).filter((c) => c.key !== key));
        return index;
      },
      restore: (card, index, note) => {
        setCards((list) => {
          const rest = (list ?? []).filter((c) => c.key !== card.key);
          rest.splice(Math.min(Math.max(index, 0), rest.length), 0, card);
          return rest;
        });
        setNotes((n) => ({ ...n, [card.key]: note }));
      },
      update: (key, fn) => setCards((list) => (list ?? []).map((c) => (c.key === key ? fn(c) : c))),
      clearNote: (key) =>
        setNotes((n) => {
          if (!(key in n)) return n;
          const rest = { ...n };
          delete rest[key];
          return rest;
        }),
      notify: (text) => {
        if (timer.current) clearTimeout(timer.current);
        setToast({ id: Date.now() + Math.random(), text });
        timer.current = setTimeout(() => setToast(null), TOAST_MS);
      },
    }),
    [cards, extra, notes, toast],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useNeeds(): Store {
  const store = React.useContext(Ctx);
  if (!store) throw new Error("useNeeds needs a NeedsProvider");
  return store;
}
