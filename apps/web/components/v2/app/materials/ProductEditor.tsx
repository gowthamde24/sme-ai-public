"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import type { MaterialItemOut, MaterialPhotoOut } from "@contracts";

import { rupeesToPaise } from "@/lib/money";
import type { FormField } from "@/lib/packs/form-fields";

import { FreshPhotos } from "../catalogue/FreshPhotos";
import { PhotoTray, type TraySlot } from "../catalogue/PhotoTray";
import { moveItem } from "../catalogue/catalogue-logic";
import type { Uploader } from "../catalogue/catalogue-types";
import { photoErrorKey } from "../catalogue/photo-errors";
import { preparePhoto } from "../catalogue/prepare-photo";
import { uploaderFor } from "../catalogue/upload-client";
import { CustomFieldsInputs, type FieldValues } from "../fields/CustomFieldsInputs";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet } from "../visits/styles";

const MAX_PHOTOS = 8;
const MAX_NAME = 120;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const UNITS = ["piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload"] as const;
const STOCKS = ["in_stock", "few_left", "made_to_order"] as const;

export type SaveInput = { name: string; sellUnit: (typeof UNITS)[number]; areaUnit: "sq_ft" | "sq_m" | null; stockStatus: (typeof STOCKS)[number]; active: boolean; price?: { rupees: number } | { clear: true } };
type Refused = { ok: false; error: string; mfa?: boolean; stale?: boolean };
export type Outcome = { ok: true; item: MaterialItemOut } | Refused;
export type EditorActions = {
  save: (itemId: string, input: SaveInput) => Promise<Outcome>;
  saveCustom?: (itemId: string, values: Record<string, never>) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (photoId: string) => Promise<Outcome>;
  reorder: (itemId: string, photoIds: string[]) => Promise<Outcome>;
};

type Slot =
  | { key: string; kind: "saved"; photoId: string }
  | { key: string; kind: "new"; photoId: string; file: File; preview: string | null; status: "waiting" | "uploading" | "done" | "failed"; percent: number; error: string | null; stored: MaterialPhotoOut | null };

let seq = 0;
const newKey = () => `new-${++seq}`;

/**
 * Add or change a product that is sold by area, weight or piece (job CO; Owner and Admin). The details are kept first, then the extra details of the business type (GST rate, HSN code, pieces per area, pieces per pallet,
 * minimum order, lead days, size, thickness ...: the owner's own figures, nothing is assumed), then the photos one at a time, then the new order, and "show to customers" last, once a photo is there. The same ids are used
 * on a second try, so nothing doubles. The exact price is the Owner's alone (an Admin's form sends none).
 */
export function ProductEditor(p: { base: string; itemId: string; item: MaterialItemOut | null; role: "owner" | "admin"; words: TodayWords; actions: EditorActions; uploadUrl: string; fields?: readonly FormField[]; custom?: FieldValues; uploader?: Uploader; prepare?: typeof preparePhoto; go?: (href: string) => void }) {
  const { words, item } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const upload = React.useMemo(() => p.uploader ?? uploaderFor(p.uploadUrl), [p.uploader, p.uploadUrl]);
  const prepare = p.prepare ?? preparePhoto;
  const owner = p.role === "owner";
  const [name, setName] = React.useState(item?.name ?? "");
  const [unit, setUnit] = React.useState<(typeof UNITS)[number]>(item?.sell_unit ?? "sq_ft");
  const [areaUnit, setAreaUnit] = React.useState<"" | "sq_ft" | "sq_m">(item?.area_unit ?? "");
  const [stock, setStock] = React.useState<(typeof STOCKS)[number]>(item?.stock_status ?? "in_stock");
  const [active, setActive] = React.useState(item?.active ?? false);
  const [custom, setCustom] = React.useState<FieldValues>(p.custom ?? {});
  const [priceText, setPriceText] = React.useState("");
  const [clearPrice, setClearPrice] = React.useState(false);
  const [slots, setSlots] = React.useState<Slot[]>(() => (item?.photos ?? []).map((ph) => ({ key: ph.id, kind: "saved" as const, photoId: ph.id })));
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [known, setKnown] = React.useState<Map<string, MaterialPhotoOut>>(() => new Map((item?.photos ?? []).map((ph) => [ph.id, ph])));
  const [server, setServer] = React.useState<MaterialItemOut | null>(item);
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<{ text: string; mfa?: boolean } | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const takeRef = React.useRef<HTMLInputElement>(null);
  const chooseRef = React.useRef<HTMLInputElement>(null);
  const slotsRef = React.useRef(slots);
  React.useEffect(() => {
    slotsRef.current = slots;
  });
  const fromServer = React.useMemo(() => new Map((item?.photos ?? []).map((ph) => [ph.id, ph])), [item]);
  const photoOf = (id: string) => fromServer.get(id) ?? known.get(id);
  React.useEffect(
    () => () => {
      for (const s of slotsRef.current) if (s.kind === "new" && s.preview) URL.revokeObjectURL(s.preview);
    },
    [],
  );

  const liveCount = slots.length;
  const showActive = active && liveCount > 0;
  const patch = (key: string, change: Partial<Extract<Slot, { kind: "new" }>>) => setSlots((cur) => cur.map((s) => (s.key === key && s.kind === "new" ? { ...s, ...change } : s)));

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const errors: string[] = [];
    const room = MAX_PHOTOS - slotsRef.current.length;
    const list = Array.from(files);
    const take = list.slice(0, Math.max(0, room));
    if (list.length > take.length) errors.push(say(words, "catalogue.photo.skipped", { n: list.length - take.length }));
    const added: Slot[] = [];
    for (const file of take) {
      if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
        errors.push(`${file.name}: ${say(words, "catalogue.photo.err.type")}`);
        continue;
      }
      added.push({ key: newKey(), kind: "new", photoId: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: "waiting", percent: 0, error: null, stored: null });
    }
    setPicked(errors);
    if (added.length) setSlots((cur) => [...cur, ...added]);
    if (takeRef.current) takeRef.current.value = "";
    if (chooseRef.current) chooseRef.current.value = "";
  }

  function removeAt(index: number) {
    const s = slots[index];
    if (!s) return;
    if (s.kind === "new") {
      if (s.preview) URL.revokeObjectURL(s.preview);
      if (s.stored) setRemoved((cur) => [...cur, s.stored!.id]);
    } else setRemoved((cur) => [...cur, s.photoId]);
    setSlots((cur) => cur.filter((_, i) => i !== index));
  }

  const whyOf = (code: string) => say(words, photoErrorKey(code));
  function refuse(out: Refused) {
    setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setStep(null);
    setBusy(false);
  }

  async function uploadOne(s: Extract<Slot, { kind: "new" }>): Promise<{ ok: true; photos: MaterialPhotoOut[] } | { ok: false }> {
    patch(s.key, { status: "uploading", percent: 0, error: null });
    const prepared = await prepare(s.file);
    if (!prepared.ok) {
      patch(s.key, { status: "failed", error: whyOf(prepared.code) });
      return { ok: false };
    }
    const out = await upload(prepared.blob, s.photoId, (percent) => patch(s.key, { percent }));
    if (!out.ok) {
      patch(s.key, { status: "failed", error: whyOf(out.code) });
      return { ok: false };
    }
    patch(s.key, { status: "done", percent: 100, stored: out.photo, error: null });
    setKnown((cur) => new Map([...cur, ...out.photos.map((ph) => [ph.id, ph] as const)]));
    return { ok: true, photos: out.photos };
  }

  async function save() {
    if (busy) return;
    setProblem(null);
    setNote(null);
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME) return setProblem({ text: say(words, "mat.err.name") });
    let price: SaveInput["price"];
    if (owner && clearPrice) price = { clear: true };
    else if (owner && priceText.trim() !== "") {
      const paise = rupeesToPaise(priceText);
      if (paise === null || paise < 100) return setProblem({ text: say(words, "mat.err.price") });
      price = { rupees: paise / 100 };
    }
    setBusy(true);
    const base: Omit<SaveInput, "active" | "price"> = { name: trimmed, sellUnit: unit, areaUnit: areaUnit === "" ? null : areaUnit, stockStatus: stock };
    const wantShown = showActive;
    const shownNow = server?.active === true && wantShown;
    setStep(say(words, "catalogue.save.details"));
    const first = await p.actions.save(p.itemId, { ...base, active: shownNow, ...(price ? { price } : {}) });
    if (!first.ok) return refuse(first);
    let current: MaterialItemOut = first.item;
    let customProblem: string | null = null;
    if (p.fields && p.fields.length > 0 && p.actions.saveCustom) {
      const kept = await p.actions.saveCustom(p.itemId, custom as Record<string, never>);
      if (!kept.ok) customProblem = kept.error;
    }
    setServer(current);
    setClearPrice(false);
    setPriceText("");
    const snapshot = slots;
    const todo = snapshot.filter((s): s is Extract<Slot, { kind: "new" }> => s.kind === "new" && s.status !== "done");
    const uploaded = new Set<string>(snapshot.filter((s) => s.kind === "new" && s.status === "done").map((s) => s.photoId));
    let failed = 0;
    for (let n = 0; n < todo.length; n++) {
      setStep(say(words, "catalogue.save.photo", { n: n + 1, total: todo.length }));
      const r = await uploadOne(todo[n]);
      if (r.ok) {
        uploaded.add(todo[n].photoId);
        current = { ...current, photos: r.photos, photo_count: r.photos.length };
      } else failed++;
    }
    if (removed.length) {
      const left: string[] = [];
      for (const id of removed) {
        const out = await p.actions.remove(id);
        if (out.ok) current = out.item;
        else {
          left.push(id);
          setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
        }
      }
      setRemoved(left);
    }
    const live = new Set(current.photos.map((ph) => ph.id));
    const wanted = snapshot.map((s) => s.photoId).filter((id) => live.has(id) && (uploaded.has(id) || snapshot.some((x) => x.kind === "saved" && x.photoId === id)));
    const now = current.photos.map((ph) => ph.id);
    if (wanted.length >= 2 && wanted.length === now.length && wanted.some((id, i) => id !== now[i])) {
      setStep(say(words, "catalogue.save.order"));
      const out = await p.actions.reorder(p.itemId, wanted);
      if (out.ok) current = out.item;
      else setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    }
    if (wantShown && !current.active && current.photos.length > 0) {
      setStep(say(words, "catalogue.save.show"));
      const out = await p.actions.save(p.itemId, { ...base, active: true });
      if (out.ok) current = out.item;
      else setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    }
    setServer(current);
    setKnown((cur) => new Map([...cur, ...current.photos.map((ph) => [ph.id, ph] as const)]));
    setStep(null);
    setBusy(false);
    if (failed > 0 || customProblem) {
      setNote([failed > 0 ? say(words, "catalogue.saved.partial") : null, customProblem].filter(Boolean).join(" "));
      return;
    }
    go(`${p.base}/materials/${p.itemId}?saved=1`);
  }

  const trayRows: TraySlot[] = slots.map((s) => {
    if (s.kind === "saved") return { key: s.key, src: photoOf(s.photoId)?.thumb_url ?? null, fresh: false, status: "saved", percent: 0, error: null };
    return { key: s.key, src: s.stored?.thumb_url ?? s.preview, fresh: true, status: s.status, percent: s.percent, error: s.error };
  });
  const backHref = item ? `${p.base}/materials/${p.itemId}` : `${p.base}/materials`;
  return (
    <FreshPhotos seconds={item && item.photos.length ? Math.min(...item.photos.map((x) => x.expires_in_seconds)) : null}>
      <form data-screen="product-edit" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-3xl flex-col gap-5">
        <div>
          <label htmlFor="mat-name" className={label}>{say(words, "mat.field.name")}</label>
          <input id="mat-name" value={name} maxLength={MAX_NAME} disabled={busy} onChange={(e) => setName(e.target.value)} aria-describedby="mat-name-help" className={field} />
          <p id="mat-name-help" className={help}>{say(words, "mat.field.name.help")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="mat-unit" className={label}>{say(words, "mat.field.unit")}</label>
            <select id="mat-unit" value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value as (typeof UNITS)[number])} aria-describedby="mat-unit-help" className={field}>
              {UNITS.map((u) => (<option key={u} value={u}>{say(words, `mat.unit.${u}`)}</option>))}
            </select>
            <p id="mat-unit-help" className={help}>{say(words, "mat.field.unit.help")}</p>
          </div>
          <div>
            <label htmlFor="mat-area" className={label}>{say(words, "mat.field.area")}</label>
            <select id="mat-area" value={areaUnit} disabled={busy} onChange={(e) => setAreaUnit(e.target.value as "" | "sq_ft" | "sq_m")} aria-describedby="mat-area-help" className={field}>
              <option value="">{say(words, "mat.field.area.none")}</option>
              <option value="sq_ft">{say(words, "mat.unit.sq_ft")}</option>
              <option value="sq_m">{say(words, "mat.unit.sq_m")}</option>
            </select>
            <p id="mat-area-help" className={help}>{say(words, "mat.field.area.help")}</p>
          </div>
        </div>
        <div>
          <label htmlFor="mat-stock" className={label}>{say(words, "catalogue.field.stock")}</label>
          <select id="mat-stock" value={stock} disabled={busy} onChange={(e) => setStock(e.target.value as (typeof STOCKS)[number])} className={`${field} max-w-72`}>
            {STOCKS.map((s) => (<option key={s} value={s}>{say(words, `catalogue.stock.${s}`)}</option>))}
          </select>
        </div>
        {p.fields && p.fields.length > 0 ? <CustomFieldsInputs fields={p.fields} values={custom} onChange={setCustom} words={{ title: say(words, "mat.specs.title"), yes: say(words, "fields.form.yes"), no: say(words, "fields.form.no"), pick: say(words, "fields.form.pick") }} idPrefix="mat-cf" disabled={busy} /> : null}
        <div data-part="exact-price" className="rounded-2xl border border-line p-4">
          {owner ? (
            <>
              <label htmlFor="mat-price" className={label}>{say(words, "mat.field.price")} (₹)</label>
              <input id="mat-price" inputMode="decimal" autoComplete="off" value={priceText} disabled={busy || clearPrice} onChange={(e) => setPriceText(e.target.value)} aria-describedby="mat-price-help" className={`${field} max-w-60`} />
              <p id="mat-price-help" className={help}>{say(words, "mat.field.price.help")}</p>
              {item?.price_text ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-base font-semibold">{say(words, "catalogue.form.price.now", { price: item.price_text })}</p>
                  <label className="flex min-h-11 items-center gap-3 text-base">
                    <input type="checkbox" className="size-5 shrink-0 accent-brand-text" checked={clearPrice} disabled={busy} onChange={(e) => setClearPrice(e.target.checked)} />
                    {say(words, "catalogue.form.price.clear")}
                  </label>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{say(words, "mat.field.price")}</p>
              <p className="mt-1 text-base">{item?.price_text ?? say(words, "catalogue.field.none")}</p>
              <p className={help}>{say(words, "catalogue.form.price.other")}</p>
            </>
          )}
        </div>
        <section aria-labelledby="mat-photos" className="flex flex-col gap-3">
          <div>
            <h2 id="mat-photos" className="font-display text-xl font-bold">{say(words, "catalogue.form.photos")}</h2>
            <p className={help}>{say(words, "mat.photos.help")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || slots.length >= MAX_PHOTOS} onClick={() => takeRef.current?.click()} className={primary}>{say(words, "catalogue.photo.take")}</button>
            <button type="button" disabled={busy || slots.length >= MAX_PHOTOS} onClick={() => chooseRef.current?.click()} className="inline-flex min-h-11 items-center justify-center rounded-full border border-edge px-[18px] text-[15px] font-semibold hover:bg-surface-2 disabled:opacity-60">{say(words, "catalogue.photo.choose")}</button>
            <input ref={takeRef} type="file" accept={PHOTO_TYPES.join(",")} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-input="take" onChange={(e) => void addFiles(e.target.files)} />
            <input ref={chooseRef} type="file" accept={PHOTO_TYPES.join(",")} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-input="choose" onChange={(e) => void addFiles(e.target.files)} />
          </div>
          {picked.length ? (<ul className={`${errorLine} list-none`} role="alert">{picked.map((t) => (<li key={t}>{t}</li>))}</ul>) : null}
          {slots.length > 0 ? <PhotoTray slots={trayRows} words={words} name={name.trim() || say(words, "mat.products.add")} disabled={busy} onMove={(from, to) => setSlots((cur) => moveItem(cur, from, to))} onRemove={removeAt} onRetry={() => void save()} /> : null}
        </section>
        <div className="rounded-2xl border border-line p-4">
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={showActive} disabled={busy || liveCount === 0} onChange={(e) => setActive(e.target.checked)} aria-describedby="mat-active-help" />
            {say(words, "mat.field.active")}
          </label>
          <p id="mat-active-help" className={help}>{liveCount === 0 ? say(words, "catalogue.form.active.needs") : say(words, "mat.field.active.help")}</p>
        </div>
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {step ? <p className={okLine}>{step}</p> : null}
          {note ? <p className={okLine}>{note}</p> : null}
        </div>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? (<Link href="/app/security" className="font-semibold underline">{say(words, "today.err.mfa.link")}</Link>) : null}
          </div>
        ) : null}
        <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
          <button type="submit" disabled={busy} className={primary}>{busy ? say(words, "today.act.working") : say(words, "catalogue.save")}</button>
          <Link href={backHref} aria-disabled={busy} className={quiet}>{say(words, "today.act.cancel")}</Link>
        </div>
      </form>
    </FreshPhotos>
  );
}
