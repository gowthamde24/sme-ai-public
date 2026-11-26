"use client";

import { Building2, CalendarDays, Download, GraduationCap, Package, RefreshCw, Ticket, UtensilsCrossed, Wrench, Ellipsis, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { LIST_KINDS, NAME_MAX, type Done, type ListKind, type SellList } from "@/lib/lists/types";

import { btnMain, btnQuiet, fieldInput, fieldLabel } from "../ui";
import { makeT, type Words } from "../words";
import { cardBox } from "../Card";

/** The line icon and category colour of each kind (the product's five category colours). */
const COLOUR: Readonly<Record<string, string>> = { call: "text-[color:var(--k-call)]", chat: "text-[color:var(--k-chat)]", visit: "text-[color:var(--k-visit)]", offer: "text-[color:var(--k-offer)]", find: "text-[color:var(--k-find)]" };
const LOOK: Readonly<Record<ListKind, { icon: LucideIcon; colour: string }>> = {
  products: { icon: Package, colour: "offer" },
  digital: { icon: Download, colour: "call" },
  services: { icon: Wrench, colour: "find" },
  bookings: { icon: CalendarDays, colour: "visit" },
  courses: { icon: GraduationCap, colour: "chat" },
  subscriptions: { icon: RefreshCw, colour: "call" },
  rentals: { icon: Building2, colour: "find" },
  food: { icon: UtensilsCrossed, colour: "offer" },
  events: { icon: Ticket, colour: "visit" },
  other: { icon: Ellipsis, colour: "chat" },
};

/**
 * Add a list (mock "Add a list"): step 1 the kind as ten boxed tiles with bare line icons in category colours (a 2-column grid on a phone, the chosen one outlined), step 2 its name. The kind's starter columns are made by the server; they are changed in Edit columns.
 * The list's id is made once when the page opens, so pressing the button twice is a retry, not a second list.
 */
export function AddListForm({ words, base, create }: { words: Words; base: string; create: (input: { id: string; name: string; kind: ListKind }) => Promise<Done<SellList>> }) {
  const t = makeT(words);
  const router = useRouter();
  const [kind, setKind] = React.useState<ListKind>("products");
  const [name, setName] = React.useState("");
  const [id] = React.useState(() => crypto.randomUUID());
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() === "") return setProblem(t("wls.err.validation_error"));
    setBusy(true);
    const r = await create({ id, name: name.trim(), kind });
    if (r.ok) return router.push(`${base}/lists/${r.data.id}?new=1`);
    setBusy(false);
    setProblem(t(`wls.err.${r.error}` as "wls.err.unavailable"));
  };
  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardBox} flex flex-col gap-4`} data-part="add-list">
      <p className="m-0 text-sm font-bold text-muted">{t("wls.new.kind")}</p>
      <div role="radiogroup" aria-label={t("wls.new.kind")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {LIST_KINDS.map((k) => {
          const { icon: Icon, colour } = LOOK[k];
          return (
            <button key={k} type="button" role="radio" aria-checked={kind === k} data-kind={k} onClick={() => setKind(k)} className={`flex min-h-[96px] flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left hover:bg-surface-2 ${kind === k ? "border-ink shadow-[inset_0_0_0_1px_var(--v2-ink,currentColor)]" : "border-edge"}`}>
              <Icon className={`size-6 ${COLOUR[colour]}`} aria-hidden="true" />
              <span className="text-[15px] font-semibold leading-tight text-ink">{t(`wls.kind.${k}` as "wls.kind.products")}</span>
              <span className="text-[13px] leading-snug text-muted">{t(`wls.kind.${k}.line` as "wls.kind.products.line")}</span>
            </button>
          );
        })}
      </div>
      <p className="m-0 mt-2 text-sm font-bold text-muted">{t("wls.new.name")}</p>
      <div className="flex max-w-md flex-col gap-1">
        <label htmlFor="wls-name" className={fieldLabel}>
          {t("wls.new.name.l")}
        </label>
        <input id="wls-name" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className={fieldInput} />
        <small className="text-[14px] text-muted">{t("wls.new.name.h")}</small>
      </div>
      {problem ? (
        <p role="alert" className="m-0 text-[15px] font-semibold text-ink">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={btnMain}>
          {busy ? t("wls.saving") : t("wls.new.create")}
        </button>
        <button type="button" onClick={() => router.push(base)} className={btnQuiet}>
          {t("wls.cancel")}
        </button>
      </div>
    </form>
  );
}
