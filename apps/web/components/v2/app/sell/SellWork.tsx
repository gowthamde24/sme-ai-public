"use client";

import { ArrowRight, Check, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { COLOURS, MAX_COLOURS } from "@/lib/api/catalogue";
import { fileKindOf, MAX_FILE_BYTES } from "@/lib/assistant-work/files";
import { buildEntry, EMPTY, formOf, type Refusal } from "@/lib/sell/forms";
import { newEntryId } from "@/lib/sell/ids";
import { BATCH_EXAMPLE, NAME_EXAMPLE, NOTE_EXAMPLE, PLACE_EXAMPLE, SAY_EXAMPLE, SIZE_SHORT } from "@/lib/sell/text";
import { BOOKING_WORDS, PLACE_WORDS, PROPERTY_STATUSES, QTY_UNITS, SIZE_UNITS, type PriceForm, type SellEntry, type SellForm, type SellNote, type SellStyle } from "@/lib/sell/types";

import { JobChip } from "../ds/JobChip";
import { MoreBox } from "../jobs/pages/parts";
import { VoiceMic } from "../voice-input/VoiceMic";
import { makeT, type Say, type Words } from "../words";
import { SellRowBody } from "./SellRow";
import { postSellFile } from "./upload-post";
import { ImportTable } from "./ImportTable";
import { parseSheetText, rowsFromCells, rowsFromDrafts, restatus, fabricIn, type ImportRow, type Parsed } from "@/lib/sell/sheet-parse";
import { xlsxCells } from "@/lib/sell/xlsx-cells";
import { shortUnit } from "./sell-text";
import type { SaveExtra, SellActions, Work } from "./types";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
/** The plain field (owner, 25 Nov 2026: no fill-in-the-blank sentences): a label above, the field full width, rounded corners, no tint. */
const inputCls = "min-h-11 w-full rounded-lg border border-edge bg-transparent px-3 text-[16px] text-ink outline-none focus:border-brand-edge aria-[invalid=true]:border-red-text";
const pill = "min-h-11 rounded-full border border-edge bg-surface-2 px-3.5 text-[16px] font-semibold text-ink outline-none focus:border-brand-edge aria-[invalid=true]:border-red-text";
const nameBox = "min-h-12 w-full rounded-xl border border-edge bg-surface px-3.5 text-[16px] text-ink outline-none focus:border-brand-edge aria-[invalid=true]:border-red-text";
const btnMain = "jb-press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-brand-edge bg-brand px-6 text-[16px] font-bold text-on-brand disabled:opacity-60";
const btnQuiet = "jb-press inline-flex min-h-12 items-center justify-center rounded-full border border-edge bg-surface px-5 text-[16px] font-semibold text-ink";

type View =
  | { v: "say" }
  /** `fresh` = the id of a NEW entry (minted once per opening, or the draft's own): the same one again is a retry, never a second row. */
  | { v: "form"; id: string | null; fresh: string | null; form: SellForm[SellStyle]; prior: SellEntry | null; hint: string | null; /** the drafts still waiting on the "I understood" card: after this one is saved the card comes back */ back?: SellEntry[] }
  | { v: "pick"; from: "photos" | "sheet" }
  /** A saree shop's price list, read and waiting for the owner to check it: nothing is added until the button. */
  | { v: "import"; rows: ImportRow[]; file: string; cut: boolean; saved: number; /** names (lower case) already added from this list: the same saree again is left out */ added?: string[]; reading?: "ai_vision" | "text_layer" | null; unreadable?: boolean }
  | { v: "understood"; entries: SellEntry[]; text: string | null; notes: SellNote[] }
  | { v: "done"; entry: SellEntry; photosPath: string | null; note: boolean }
  | { v: "message"; text: string; href: string | null };

function Fld({ label, hint, children }: { label: string; hint?: string | null; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{label}</span>
      {children}
      {hint ? <span className="text-[14px] font-normal text-muted">{hint}</span> : null}
    </label>
  );
}
function Num({ value, onChange, label, invalid }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean }) {
  return <input type="text" inputMode="decimal" autoComplete="off" data-voice="never" aria-label={label} aria-invalid={invalid ? true : undefined} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
}
function Pick<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: readonly { id: T; text: string }[]; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputCls}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.text}
        </option>
      ))}
    </select>
  );
}

function ColourButton({ chosen, open, onToggle, t, invalid }: { chosen: readonly string[]; open: boolean; onToggle: () => void; t: Say; invalid: boolean }) {
  return (
    <button type="button" data-part="colours-open" aria-expanded={open} data-invalid={invalid ? "" : undefined} onClick={onToggle} className={`${inputCls} jb-press text-left data-[invalid]:border-red-text`}>
      {chosen.length === 0 ? t("jobs.sell.p.pick") : chosen.length === 1 ? t("jobs.sell.colour.one") : t("jobs.sell.colour.n", { n: chosen.length })}
    </button>
  );
}
function ColourPanel({ chosen, onChange, t }: { chosen: readonly string[]; onChange: (c: string[]) => void; t: Say }) {
  return (
    <span role="group" aria-label={t("jobs.sell.p.colours")} data-part="colours" className="flex flex-wrap gap-1.5">
      {COLOURS.map((c) => {
        const on = chosen.includes(c);
        const full = !on && chosen.length >= MAX_COLOURS;
        return (
          <button key={c} type="button" aria-pressed={on} disabled={full} onClick={() => onChange(on ? chosen.filter((x) => x !== c) : [...chosen, c])} className={`jb-press min-h-9 rounded-full border px-3 text-[14px] font-semibold disabled:opacity-40 ${on ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-ink"}`}>
            {t(`catalogue.colour.${c}`)}
          </button>
        );
      })}
      <span className="basis-full text-[13px] text-muted">{t("jobs.sell.p.colours.max", { n: MAX_COLOURS })}</span>
    </span>
  );
}

function Fields({ style, form, set, t, bad, owner }: { style: SellStyle; form: SellForm[SellStyle]; set: (f: SellForm[SellStyle]) => void; t: Say; bad: Refusal | null; owner: boolean }) {
  const inv = (field: string) => bad?.field === field;
  const [coloursOpen, setColoursOpen] = useState(style === "products" && (form as SellForm["products"]).colours.length === 0);
  const u = <K extends string>(k: K, v: unknown) => set({ ...form, [k]: v } as SellForm[SellStyle]);
  const name = (
    <label className="flex flex-col gap-1.5">
      <span className="text-[15px] font-bold text-ink">{t("jobs.sell.f.name")}</span>
      <input type="text" name="name" maxLength={128} autoComplete="off" data-voice="allow" aria-invalid={inv("name") ? true : undefined} value={(form as { name: string }).name} onChange={(e) => u("name", e.target.value)} placeholder={NAME_EXAMPLE[style]} className={nameBox} />
    </label>
  );
  const options = <T extends string>(ids: readonly T[], key: string): { id: T; text: string }[] => ids.map((id) => ({ id, text: t(`${key}.${id}`) }));
  const grid = "grid grid-cols-1 gap-4 min-[420px]:grid-cols-2";
  if (style === "products") {
    const f = form as SellForm["products"];
    return (
      <>
        {name}
        <Fld label={t("jobs.sell.f.price")}>
          <Num value={f.price} onChange={(v) => u("price", v)} label={t("jobs.sell.f.price")} invalid={inv("price")} />
        </Fld>
        <div role="group" aria-label={t("jobs.sell.p.colours")} className="flex flex-col gap-1.5">
          <span className="text-[15px] font-bold text-ink">{t("jobs.sell.p.colours")}</span>
          <ColourButton chosen={f.colours} open={coloursOpen} onToggle={() => setColoursOpen((o) => !o)} t={t} invalid={inv("colours")} />
          {coloursOpen ? <ColourPanel chosen={f.colours} onChange={(c) => u("colours", c)} t={t} /> : null}
        </div>
        {!owner ? <p className="m-0 text-[13.5px] text-muted">{t("jobs.sell.p.admin")}</p> : null}
        <div className={grid}>
          <Fld label={t("jobs.sell.f.stock")}>
            <Pick value={f.stock} onChange={(v) => u("stock", v)} options={options(["in_stock", "few_left", "made_to_order"] as const, "jobs.sell.stock")} label={t("jobs.sell.f.stock")} />
          </Fld>
          <Fld label={t("jobs.sell.f.count")}>
            <Num value={f.count} onChange={(v) => u("count", v)} label={t("jobs.sell.f.count")} invalid={inv("count")} />
          </Fld>
        </div>
      </>
    );
  }
  if (style === "services") {
    const f = form as SellForm["services"];
    return (
      <>
        {name}
        <div className={grid}>
          <Fld label={t("jobs.sell.f.minutes.l")}>
            <Num value={f.minutes} onChange={(v) => u("minutes", v)} label={t("jobs.sell.f.minutes.l")} invalid={inv("minutes")} />
          </Fld>
          <Fld label={t("jobs.sell.f.price")}>
            <Num value={f.price} onChange={(v) => u("price", v)} label={t("jobs.sell.f.price")} invalid={inv("price")} />
          </Fld>
        </div>
        <Fld label={t("jobs.sell.f.booking")}>
          <Pick value={f.booking} onChange={(v) => u("booking", v)} options={options(BOOKING_WORDS, "jobs.sell.booking")} label={t("jobs.sell.f.booking")} />
        </Fld>
      </>
    );
  }
  if (style === "courses") {
    const f = form as SellForm["courses"];
    return (
      <>
        {name}
        <Fld label={t("jobs.sell.f.batch")}>
          <input type="text" aria-label={t("jobs.sell.f.batch")} aria-invalid={inv("batch") ? true : undefined} data-voice="allow" value={f.batch} maxLength={120} onChange={(e) => u("batch", e.target.value)} placeholder={BATCH_EXAMPLE} className={inputCls} />
        </Fld>
        <Fld label={t("jobs.sell.f.starts")}>
          <input type="date" aria-label={t("jobs.sell.f.starts")} aria-invalid={inv("startsOn") ? true : undefined} value={f.startsOn} onChange={(e) => u("startsOn", e.target.value)} className={inputCls} />
        </Fld>
        <div className={grid}>
          <Fld label={t("jobs.sell.f.fee")}>
            <Num value={f.fee} onChange={(v) => u("fee", v)} label={t("jobs.sell.f.fee")} invalid={inv("fee")} />
          </Fld>
          <Fld label={t("jobs.sell.f.seats")}>
            <Num value={f.seats} onChange={(v) => u("seats", v)} label={t("jobs.sell.f.seats")} invalid={inv("seats")} />
          </Fld>
        </div>
      </>
    );
  }
  if (style === "properties") {
    const f = form as SellForm["properties"];
    return (
      <>
        {name}
        <Fld label={t("jobs.sell.f.location")}>
          <input type="text" aria-label={t("jobs.sell.f.location")} aria-invalid={inv("location") ? true : undefined} data-voice="allow" value={f.location} maxLength={120} onChange={(e) => u("location", e.target.value)} placeholder={PLACE_EXAMPLE} className={inputCls} />
        </Fld>
        <div className={grid}>
          <Fld label={t("jobs.sell.f.size")}>
            <Num value={f.size} onChange={(v) => u("size", v)} label={t("jobs.sell.f.size")} invalid={inv("size")} />
          </Fld>
          <Fld label={t("jobs.sell.f.size.unit")}>
            <Pick value={f.sizeUnit} onChange={(v) => u("sizeUnit", v)} options={SIZE_UNITS.map((id) => ({ id, text: SIZE_SHORT[id] }))} label={t("jobs.sell.f.size.unit")} />
          </Fld>
        </div>
        <Fld label={t("jobs.sell.f.price")} hint={t("jobs.sell.r.price.help")}>
          <Num value={f.price} onChange={(v) => u("price", v)} label={t("jobs.sell.f.price")} invalid={inv("price")} />
        </Fld>
        <Fld label={t("jobs.sell.f.status")}>
          <Pick value={f.status} onChange={(v) => u("status", v)} options={options(PROPERTY_STATUSES, "jobs.sell.status")} label={t("jobs.sell.f.status")} />
        </Fld>
      </>
    );
  }
  const f = form as PriceForm;
  const unit = f.unit;
  const per = t(`jobs.sell.unit.${unit}.one`);
  const unitWord = shortUnit(unit) || t(`jobs.sell.unit.${unit}`);
  const setRate = (i: number, k: "fromQty" | "rate", v: string) => u("rates", f.rates.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  return (
    <>
      {name}
      <div className={grid}>
        <Fld label={t("jobs.sell.f.moq")}>
          <Num value={f.moq} onChange={(v) => u("moq", v)} label={t("jobs.sell.f.moq")} invalid={inv("moq")} />
        </Fld>
        <Fld label={t("jobs.sell.f.unit")}>
          <Pick value={f.unit} onChange={(v) => u("unit", v)} options={QTY_UNITS.map((id) => ({ id, text: t(`jobs.sell.unit.${id}`) }))} label={t("jobs.sell.f.unit")} />
        </Fld>
      </div>
      <fieldset data-part="rates" className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
        <legend className="mb-1 text-[15px] font-bold text-ink">{t("jobs.sell.w.rates")}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-x-3 text-[14px] font-semibold text-muted" aria-hidden="true">
          <span>{t("jobs.sell.w.col.from", { unit: unitWord })}</span>
          <span>{t("jobs.sell.w.col.rate", { per })}</span>
          <span />
        </div>
        {f.rates.map((r, i) => (
          <div key={i} data-part="rate" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-x-3">
            <Num value={r.fromQty} onChange={(v) => setRate(i, "fromQty", v)} label={t("jobs.sell.w.from")} invalid={inv("rates")} />
            <Num value={r.rate} onChange={(v) => setRate(i, "rate", v)} label={t("jobs.sell.f.rate")} invalid={inv("rates")} />
            {f.rates.length > 1 ? (
              <button type="button" aria-label={t("jobs.sell.w.remove")} onClick={() => u("rates", f.rates.filter((_, n) => n !== i))} className="jb-press grid size-11 shrink-0 place-items-center rounded-full text-muted">
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {f.rates.length < 8 ? (
          <button type="button" data-part="add-rate" onClick={() => u("rates", [...f.rates, { fromQty: "", rate: "" }])} className="jb-press min-h-11 self-start rounded-lg border border-edge bg-transparent px-4 text-[15px] font-semibold text-ink">
            {t("jobs.sell.w.add")}
          </button>
        ) : null}
      </fieldset>
      <Fld label={t("jobs.sell.w.until.l")} hint={t("jobs.sell.w.until.hint")}>
        <input type="date" aria-label={t("jobs.sell.w.until.l")} aria-invalid={inv("goodUntil") ? true : undefined} value={f.goodUntil} onChange={(e) => u("goodUntil", e.target.value)} className={inputCls} />
      </Fld>
    </>
  );
}

function MoreFields({ style, form, set, t, base, entry, live }: { style: SellStyle; form: SellForm[SellStyle]; set: (f: SellForm[SellStyle]) => void; t: Say; base: string; entry: SellEntry | null; live: boolean }) {
  const u = (k: string, v: unknown) => set({ ...form, [k]: v } as SellForm[SellStyle]);
  return (
    <MoreBox title={t("jobs.sell.more")} sub={t(`jobs.sell.more.${style}`)}>
      {style === "products" ? (
        <p className="m-0 text-[14px] leading-snug text-muted">
          {live ? (
            <Link href={entry ? `${base}/catalogue/${entry.id}` : `${base}/catalogue/new`} prefetch={false} className="font-semibold text-brand-text underline underline-offset-4">
              {t("jobs.sell.p.photos")}
            </Link>
          ) : (
            t("jobs.sell.p.photos.soon")
          )}
        </p>
      ) : null}
      {style === "services" ? (
        <>
          <label className="flex items-center gap-3 text-[15px] text-ink">
            <input type="checkbox" checked={(form as SellForm["services"]).priceFrom} onChange={(e) => u("priceFrom", e.target.checked)} className="size-6 accent-brand-text" />
            {t("jobs.sell.s.from")}
          </label>
          <label className="flex flex-col gap-1.5 text-[15px] text-ink">
            {t("jobs.sell.s.place")}
            <select value={(form as SellForm["services"]).place} onChange={(e) => u("place", e.target.value)} className={inputCls}>
              <option value="">{t("jobs.sell.s.place.none")}</option>
              {PLACE_WORDS.map((p) => (
                <option key={p} value={p}>
                  {t(`jobs.sell.place.${p}`)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {style === "properties" ? (
        <label className="flex flex-col gap-1.5 text-[15px] text-ink">
          {t("jobs.sell.r.note")}
          <input type="text" maxLength={200} data-voice="allow" value={(form as SellForm["properties"]).note} onChange={(e) => u("note", e.target.value)} placeholder={NOTE_EXAMPLE} className={nameBox} />
        </label>
      ) : null}
      {style === "courses" ? (
        <label className="flex flex-col gap-1.5 text-[15px] text-ink">
          {t("jobs.sell.c.description")}
          <input type="text" maxLength={200} data-voice="allow" value={(form as SellForm["courses"]).description} onChange={(e) => u("description", e.target.value)} className={nameBox} />
        </label>
      ) : null}
      {style === "courses" || style === "pricelist" ? <p className="m-0 text-[14px] leading-snug text-muted">{t(`jobs.sell.more.${style}.help`)}</p> : null}
    </MoreBox>
  );
}

/**
 * THE WORK SHEET (one lazy chunk; a bottom sheet on the phone, a side panel from 768 px): Say it (a box and the app's own microphone), the add/change form in plain sentences with the choices inside (max 4 choices, the rest under More choices), the "I understood" card
 * (nothing is saved until Save) and the answer to Photos / Sheet in test mode. Every save goes through `actions.save`, which for a product of a real workspace is the OLD catalogue form's save.
 */
export default function SellWork({ style, work, words, base, actions, live, ownerPrice, paths, onClose, onSaved, onRemoved }: { style: SellStyle; work: Work; words: Words; base: string; actions: SellActions; live: boolean; ownerPrice: boolean; paths: { photos: string | null; sheet: string | null }; onClose: () => void; onSaved: (e: SellEntry) => void; onRemoved?: (id: string) => void }) {
  const t = makeT(words);
  void paths;
  const dialogRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  /** A real workspace (not the test mode) reads talk, photos and sheets with the assistant's reading call, for every style but products (the catalogue has its own photo page and its closed-word Say it). */
  const reading = live && style !== "products";
  /** A real saree shop's "Import a sheet": the list is read in the browser (Excel, CSV) or by the reading call (PDF, photo), shown as a table to check, then added one by one like a typed saree. */
  const importing = live && style === "products";
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const saveIds = useRef(new Map<string, string>());
  // the id of a NEW entry is minted ONCE per opening of the sheet: a retry after a failure sends the same id (the API never makes a second row)
  const [freshId] = useState(() => newEntryId());
  const [view, setView] = useState<View>(() => (work.kind === "say" ? { v: "say" } : work.kind === "edit" ? { v: "form", id: work.entry.id, fresh: null, form: formOf(work.entry), prior: work.entry, hint: null } : work.kind === "add" ? { v: "form", id: null, fresh: freshId, form: structuredClone(EMPTY[style]), prior: null, hint: null } : work.kind === "read" && (reading || importing) ? { v: "pick", from: work.from } : { v: "message", text: "", href: null }));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState(false);
  const [bad, setBad] = useState<Refusal | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // "Take photos" / "Import a sheet" in test mode: the made-up reading comes back as the same "I understood" card
  useEffect(() => {
    if (work.kind !== "read" || reading || importing) return;
    let live_ = true;
    void actions.readSheet(style, work.from).then((r) => {
      if (!live_) return;
      setView(r.ok ? { v: "understood", entries: r.data.entries, text: null, notes: [] } : { v: "message", text: r.error, href: null });
    });
    return () => {
      live_ = false;
    };
  }, [actions, style, work, reading, importing]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** A refusal of the server as the sheet shows it: the sentence, and (a price change needs the second step) the way to Security. */
  function refused(r: { error: string; mfa?: boolean }) {
    setError(r.error);
    setMfa(r.mfa === true);
  }

  async function say(e?: React.FormEvent) {
    e?.preventDefault();
    if (text.trim().length < 3) {
      setError(t("jobs.sell.say.err"));
      return;
    }
    setBusy(true);
    setError(null);
    setMfa(false);
    if (reading) {
      // a real workspace: the assistant reads the owner's own words (any language), up to 20 drafts and plain notes; nothing is saved
      const r = await actions.read(style, { kind: "talk", text });
      setBusy(false);
      if (!r.ok) return refused(r);
      if (r.data.entries.length === 0) return setError(t(r.data.unclear ? "jobs.sell.u.unclear" : "jobs.sell.u.none"));
      setView({ v: "understood", entries: r.data.entries, text, notes: r.data.notes });
      return;
    }
    const r = await actions.understand(style, text);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const f = r.data.form as { name: string };
    if (f.name.trim() === "") {
      setError(t("jobs.sell.u.none"));
      return;
    }
    const built = buildEntry(style, freshId, r.data.form, null, ownerPrice);
    if (built.ok) setView({ v: "understood", entries: [built.entry], text, notes: [] });
    else {
      setBad(built);
      setView({ v: "form", id: null, fresh: freshId, form: r.data.form, prior: null, hint: t("jobs.sell.u.more") });
    }
  }

  /** A photo or a sheet of the owner's: it goes up through the assistant's file route (kept 24 hours), then the reading call asks for the drafts. */
  async function pickList(file: File) {
    const name = file.name.toLowerCase();
    if (file.size <= 0) return setError(t("jobs.sell.file.empty"));
    if (file.size > MAX_FILE_BYTES) return setError(t("jobs.sell.file.size"));
    setBusy(true);
    setError(null);
    setMfa(false);
    let parsed: Parsed | null = null;
    let readBy: "ai_vision" | "text_layer" | null = null;
    let unreadable = false;
    try {
      if (/\.(csv|tsv|txt)$/.test(name) || file.type.startsWith("text/")) parsed = parseSheetText(await file.text());
      else if (name.endsWith(".xlsx")) parsed = rowsFromCells(await xlsxCells(await file.arrayBuffer()));
      else if (name.endsWith(".xls")) {
        setBusy(false);
        return setError(t("jobs.sell.imp.err.xls"));
      }
    } catch {
      setBusy(false);
      return setError(t("jobs.sell.imp.err.unreadable"));
    }
    if (parsed === null) {
      // a PDF or a photo of the list: the reading call (the price-list reading: name and rate) turns it into the same rows
      const kind = fileKindOf(file.name, file.type);
      if (kind !== "image" && kind !== "pdf") {
        setBusy(false);
        return setError(t("jobs.sell.file.type"));
      }
      const up = await postSellFile(base, file);
      if (!up.ok) {
        setBusy(false);
        return setError(t(`jobs.sell.file.${up.error}`));
      }
      // the products reading (C1, 26 Nov 2026): every draft comes back with how sure the reading is; the table shows them all and marks the unsure ones
      const r = await actions.readProducts(up.fileId);
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
      parsed = rowsFromDrafts(r.data.drafts);
      if (r.data.notes.some((n) => n.code === "too_many")) parsed = { ...parsed, cut: true };
      readBy = r.data.readBy;
      unreadable = r.data.unclear || r.data.notes.some((n) => n.code === "unreadable");
    }
    setBusy(false);
    if (parsed.error) return setError(t(parsed.error === "empty" ? "jobs.sell.imp.err.empty" : "jobs.sell.imp.err.no_rows"));
    setView({ v: "import", rows: parsed.rows, file: file.name, cut: parsed.cut, saved: 0, reading: readBy, unreadable });
  }

  /** The ready rows, one by one, each as the form of a typed saree (the same save, the same refusals); a refusal stops the run and keeps what is left on the screen. */
  async function addImported(rows: ImportRow[], addedBefore: string[]) {
    const ready = rows.filter((r) => r.status === "ok");
    setBusy(true);
    setError(null);
    setMfa(false);
    let left = rows;
    let saved = 0;
    const names = new Set(addedBefore);
    for (const row of ready) {
      setProgress({ done: saved, total: ready.length });
      const id = saveIds.current.get(row.id) ?? newEntryId();
      saveIds.current.set(row.id, id);
      const form: SellForm["products"] = { name: row.name.trim(), price: String(row.price ?? ""), colours: [row.colour ?? "multi"], stock: row.count === 0 ? "made_to_order" : "in_stock", count: row.count === null ? "" : String(row.count) };
      const r = await actions.save("products", null, form, { freshId: id, fabric: fabricIn(row.name) });
      if (!r.ok) {
        setBusy(false);
        setProgress(null);
        setView((v) => (v.v === "import" ? { ...v, rows: restatus(left, names), added: [...names], saved: v.saved + saved } : v));
        return refused(r);
      }
      onSaved(r.data.entry);
      names.add(row.name.trim().toLowerCase());
      left = left.filter((x) => x.id !== row.id);
      saved++;
    }
    setBusy(false);
    setProgress(null);
    setView((v) => (v.v === "import" ? { ...v, rows: restatus(left, names), added: [...names], saved: v.saved + saved } : v));
  }

  async function pick(file: File | undefined, from: "photos" | "sheet") {
    if (!file) return;
    if (importing) return pickList(file);
    const kind = fileKindOf(file.name, file.type);
    if (kind === null || (kind !== "image" && kind !== "pdf" && kind !== "sheet")) return setError(t("jobs.sell.file.type"));
    if (file.size <= 0) return setError(t("jobs.sell.file.empty"));
    if (file.size > MAX_FILE_BYTES) return setError(t("jobs.sell.file.size"));
    setBusy(true);
    setError(null);
    setMfa(false);
    const up = await postSellFile(base, file);
    if (!up.ok) {
      setError(t(`jobs.sell.file.${up.error}`));
      return setBusy(false);
    }
    const fileId = up.fileId;
    const r = await actions.read(style, { kind: from === "photos" ? "photo" : "sheet", fileId });
    setBusy(false);
    if (!r.ok) return refused(r);
    if (r.data.entries.length === 0) return setError(t(r.data.unclear ? "jobs.sell.u.unclear" : "jobs.sell.u.none"));
    setView({ v: "understood", entries: r.data.entries, text: null, notes: r.data.notes });
  }

  /** What the form cannot say of the entry being changed: a course's seats are the owner's own count (kept unless the total changed). */
  const extraOf = (v: Extract<View, { v: "form" }>): SaveExtra => ({ ...(v.fresh ? { freshId: v.fresh } : {}), ...(v.prior?.style === "courses" ? { course: { seats: v.prior.seats, total: v.prior.total } } : {}) });

  async function saveForm() {
    if (view.v !== "form") return;
    const built = buildEntry(style, view.id ?? view.fresh ?? "draft", view.form, view.prior, ownerPrice);
    if (!built.ok) {
      setBad(built);
      setError(t(`jobs.sell.err.${built.code}`));
      return;
    }
    setBad(null);
    setBusy(true);
    setError(null);
    setMfa(false);
    const r = await actions.save(style, view.id, view.form, extraOf(view));
    setBusy(false);
    if (!r.ok) return refused(r);
    onSaved(r.data.entry);
    if (r.data.photosPath) setView({ v: "done", entry: r.data.entry, photosPath: r.data.photosPath, note: r.data.note === "count" });
    else if (view.back && view.back.length > 0) setView({ v: "understood", entries: view.back, text: null, notes: [] });
    else onClose();
  }

  /** Save the drafts one by one with the id each already has (a retry sends the same ids). A draft that is not complete yet (no price: it is never guessed) stays on the card for the owner to finish with Change. */
  async function saveAll(entries: SellEntry[], notes: SellNote[]) {
    setBusy(true);
    setError(null);
    setMfa(false);
    let left = entries;
    for (const entry of entries) {
      if (!buildEntry(style, entry.id, formOf(entry), null, ownerPrice).ok) continue;
      const r = await actions.save(style, null, formOf(entry), { freshId: entry.id });
      if (!r.ok) {
        setBusy(false);
        setView((v) => (v.v === "understood" ? { ...v, entries: left, notes } : v));
        return refused(r);
      }
      onSaved(r.data.entry);
      left = left.filter((x) => x.id !== entry.id);
    }
    setBusy(false);
    if (left.length === 0) return onClose();
    setView((v) => (v.v === "understood" ? { ...v, entries: left, notes: [] } : v));
    setError(t("jobs.sell.u.left"));
  }

  async function remove() {
    if (view.v !== "form" || !view.id) return;
    if (!removing) return setRemoving(true);
    setBusy(true);
    setError(null);
    setMfa(false);
    const r = await actions.remove(style, view.id);
    setBusy(false);
    if (!r.ok) return refused(r);
    onRemoved?.(r.data.id);
    onClose();
  }

  const title = view.v === "say" ? t("jobs.sell.say.title") : view.v === "understood" ? t("jobs.sell.u.title") : view.v === "form" ? t(`jobs.sell.style.${style}.${view.id && view.prior ? "edit" : "add"}`) : view.v === "done" ? t("jobs.sell.done") : view.v === "pick" ? t(`jobs.sell.${view.from}.title`) : view.v === "import" ? t("jobs.sell.imp.title") : t("jobs.sell.fill.title");

  return (
    <div data-part="sell-work" className="fixed inset-0 z-[85] flex items-end justify-center md:items-stretch md:justify-end">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="sl-veil absolute inset-0 cursor-default border-0 bg-black/45 p-0" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="sell-title" tabIndex={-1} onKeyDown={onKeyDown} className="sl-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-surface text-ink shadow-[var(--v2-shadow)] outline-none md:max-h-none md:w-[520px] md:max-w-full md:rounded-l-3xl md:rounded-tr-none">
        <span aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-edge opacity-70 md:hidden" />
        <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-2 md:px-5 md:pt-4">
          <h2 id="sell-title" className="m-0 font-display text-[22px] font-bold leading-tight text-ink">
            {title}
          </h2>
          <button type="button" data-action="close" onClick={onClose} aria-label={t("jobs.sell.close")} className="jb-press grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 text-ink">
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-8 pt-2 md:px-5">
          {view.v === "say" ? (
            <form onSubmit={(e) => void say(e)} data-part="say" className="flex flex-col gap-2.5">
              <label htmlFor="sell-say" className="text-[15px] font-bold leading-snug text-ink">
                {t("jobs.sell.say.label")}
              </label>
              <div className="rounded-2xl border border-brand-edge bg-surface p-2 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--v2-brand)_25%,transparent)]">
                <textarea ref={boxRef} id="sell-say" name="sell-say" rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAY_EXAMPLE[style]} data-voice="allow" autoFocus className="block w-full resize-none rounded-xl border-0 bg-transparent px-2 py-1.5 text-[16px] leading-snug text-ink outline-none placeholder:text-muted" />
                <div className="flex items-center justify-end gap-2">
                  <VoiceMic target={boxRef} size="icon" />
                  <button type="submit" aria-label={t("jobs.sell.say.go")} disabled={busy} className="jb-press grid size-11 shrink-0 place-items-center rounded-full border border-brand-edge bg-brand text-on-brand disabled:opacity-60">
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </button>
                </div>
              </div>
              <p className="m-0 text-[13.5px] leading-snug text-muted">{t("jobs.sell.u.note")}</p>
            </form>
          ) : null}

          {view.v === "form" ? (
            <form
              data-part="form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveForm();
              }}
              className="flex flex-col gap-4"
            >
              {view.hint ? <p className="m-0 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">{view.hint}</p> : null}
              <Fields style={style} form={view.form} set={(f) => setView({ ...view, form: f })} t={t} bad={bad} owner={ownerPrice} />
              <MoreFields style={style} form={view.form} set={(f) => setView({ ...view, form: f })} t={t} base={base} entry={view.prior} live={live} />
              <button type="submit" disabled={busy} className={btnMain}>
                {busy ? t("jobs.sell.saving") : t(`jobs.sell.style.${style}.save`)}
              </button>
              {view.id && view.prior && style !== "products" ? (
                <button type="button" data-action="remove" disabled={busy} onClick={() => void remove()} className={btnQuiet}>
                  <Trash2 aria-hidden="true" className="mr-2 size-4" />
                  {removing ? t("jobs.sell.remove.sure") : t("jobs.sell.remove")}
                </button>
              ) : null}
            </form>
          ) : null}

          {view.v === "pick" ? (
            <div data-part="pick" className="flex flex-col gap-3">
              <p className="m-0 text-[15px] leading-snug text-ink">{importing ? t("jobs.sell.imp.pick") : t(`jobs.sell.pick.${view.from}`)}</p>
              <label className={`${btnMain} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
                <Upload aria-hidden="true" className="size-4" />
                {busy ? t("jobs.sell.pick.reading") : importing ? t("jobs.sell.imp.pick.go") : t(`jobs.sell.pick.${view.from}.go`)}
                <input type="file" data-part="pick-file" accept={importing ? ".csv,.tsv,.txt,.xlsx,.xls,.pdf,image/*,.heic,.heif" : view.from === "photos" ? "image/*,.pdf,.heic,.heif" : ".csv,.tsv,.xls,.xlsx,.pdf"} disabled={busy} onChange={(e) => void pick(e.target.files?.[0], (view as Extract<View, { v: "pick" }>).from)} className="sr-only" />
              </label>
              <p className="m-0 text-[13.5px] leading-snug text-muted">{t("jobs.sell.u.note")}</p>
            </div>
          ) : null}

          {view.v === "import" && view.saved > 0 && view.rows.filter((r) => r.status === "ok").length === 0 && !busy ? (
            <div data-part="import-done" className="flex flex-col gap-3">
              <JobChip tone="done">{t("jobs.sell.done.chip")}</JobChip>
              <p className="m-0 text-[16px] font-semibold leading-snug text-ink">{t("jobs.sell.imp.done", { n: view.saved })}</p>
              <p className="m-0 text-[15px] leading-snug text-muted">{t("jobs.sell.imp.photo")}</p>
              {view.rows.some((r) => r.status !== "duplicate") ? <p className="m-0 text-[14px] text-muted">{t("jobs.sell.imp.left", { n: view.rows.filter((r) => r.status !== "duplicate").length })}</p> : null}
              <div className="flex flex-wrap gap-2.5">
                <Link href={`${base}/catalogue`} prefetch={false} className={`${btnMain} no-underline`}>
                  {t("jobs.sell.imp.photos_go")}
                </Link>
                <button type="button" onClick={onClose} className={btnQuiet}>
                  {t("jobs.sell.done.later")}
                </button>
              </div>
            </div>
          ) : view.v === "import" ? (
            <ImportTable rows={view.rows} added={new Set(view.added ?? [])} file={view.file} cut={view.cut} reading={view.reading ?? null} unreadable={view.unreadable === true} t={t} busy={busy} progress={progress} onRows={(rows) => setView((v) => (v.v === "import" ? { ...v, rows } : v))} onAdd={() => void addImported(view.rows, view.added ?? [])} onCancel={onClose} />
          ) : null}

          {view.v === "understood" ? (
            <div data-part="understood" className="flex flex-col gap-3">
              {view.text ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-bold uppercase tracking-wide text-muted">{t("jobs.sell.u.after")}</span>
                  <q className="text-[15px] leading-snug text-ink">{view.text}</q>
                </div>
              ) : null}
              <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface p-0">
                {view.entries.map((e, i) => (
                  <li key={e.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                    <SellRowBody entry={e} t={t} />
                    {view.entries.length > 1 ? (
                      <button type="button" data-action="change-one" aria-label={`${t("jobs.sell.u.change")}: ${i + 1}`} onClick={() => setView({ v: "form", id: null, fresh: e.id, form: formOf(e), prior: null, hint: null, back: view.entries.filter((x) => x.id !== e.id) })} className="jb-press min-h-11 shrink-0 rounded-full border border-edge bg-surface px-3.5 text-[14px] font-semibold text-ink">
                        {t("jobs.sell.u.change")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {view.notes.length > 0 ? (
                <ul data-part="notes" className="m-0 flex list-none flex-col gap-1.5 rounded-xl bg-[var(--jb-info-soft)] px-3.5 py-3 text-[14px] leading-snug text-ink">
                  {view.notes.map((n, i) => (
                    <li key={i} data-note={n.code}>
                      {n.row !== null ? `${t("jobs.sell.note.row", { n: n.row })} ` : ""}
                      {t(`jobs.sell.note.${n.code}`)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="m-0 text-[13.5px] leading-snug text-muted">{t("jobs.sell.u.note")}</p>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" data-action="save-all" disabled={busy} onClick={() => void saveAll((view as Extract<View, { v: "understood" }>).entries, (view as Extract<View, { v: "understood" }>).notes)} className={btnMain}>
                  <Check aria-hidden="true" className="size-4" />
                  {view.entries.length > 1 ? t("jobs.sell.u.save_all") : t("jobs.sell.u.save")}
                </button>
                {view.entries.length === 1 ? (
                  <button type="button" data-action="change" onClick={() => setView({ v: "form", id: null, fresh: (view as Extract<View, { v: "understood" }>).entries[0].id, form: formOf(view.entries[0]), prior: null, hint: null })} className={btnQuiet}>
                    {t("jobs.sell.u.change")}
                  </button>
                ) : (
                  <button type="button" onClick={onClose} className={btnQuiet}>
                    {t("jobs.sell.u.not_now")}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {view.v === "done" ? (
            <div data-part="done" className="flex flex-col gap-3">
              <JobChip tone="done">{t("jobs.sell.done.chip")}</JobChip>
              <p className="m-0 text-[15px] leading-snug text-ink">{t("jobs.sell.done.photos")}</p>
              {view.note ? <p className="m-0 text-[14px] text-muted">{t("jobs.sell.done.count")}</p> : null}
              <div className="flex flex-wrap gap-2.5">
                {view.photosPath ? (
                  <Link href={`${base}${view.photosPath}`} prefetch={false} className={`${btnMain} no-underline`}>
                    {t("jobs.sell.done.add")}
                  </Link>
                ) : null}
                <button type="button" onClick={onClose} className={btnQuiet}>
                  {t("jobs.sell.done.later")}
                </button>
              </div>
            </div>
          ) : null}

          {view.v === "message" && view.text !== "" ? (
            <div data-part="message" className="flex flex-col gap-3">
              <p className="m-0 text-[15px] leading-snug text-ink">{view.text}</p>
              <button type="button" onClick={onClose} className={btnQuiet}>
                {t("jobs.sell.close")}
              </button>
            </div>
          ) : null}
          {view.v === "message" && view.text === "" ? <div aria-hidden="true" className="jb-skeleton h-24 w-full" /> : null}

          {error ? (
            <p role="alert" data-part="error" className="m-0 text-[14px] font-semibold text-red-text">
              {error}
            </p>
          ) : null}
          {mfa ? (
            <Link href="/app/security" prefetch={false} data-part="security" className={`${btnQuiet} self-start no-underline`}>
              {t("jobs.tb.s5.security")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
