"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { COLOURS, FABRICS, MAX_BORDER, MAX_COLOURS, MAX_NAME, MAX_OCCASIONS, MAX_PHOTOS, OCCASIONS, PHOTO_TYPES, PRICE_BANDS, STOCK_STATUSES, ZARIS, type Colour, type Fabric, type Item, type Occasion, type Photo, type PriceBand, type StockStatus, type Zari } from "@/lib/api/catalogue";

import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, help, label, okLine, primary, quiet } from "../visits/styles";
import { FreshPhotos } from "./FreshPhotos";
import { vocab } from "./ItemCard";
import { PhotoTray, type TraySlot } from "./PhotoTray";
import { BAND_WORDS, moveItem, rupeesToPaise, soonestExpiry } from "./catalogue-logic";
import type { EditorActions, ItemOutcome, SaveInput, Uploader } from "./catalogue-types";
import { photoErrorKey } from "./photo-errors";
import { preparePhoto } from "./prepare-photo";
import { uploaderFor } from "./upload-client";

type Slot =
  | { key: string; kind: "saved"; photoId: string }
  | { key: string; kind: "new"; photoId: string; file: File; preview: string | null; status: "waiting" | "uploading" | "done" | "failed"; percent: number; error: string | null; stored: Photo | null };

export type ItemEditorProps = {
  /** `/app/tenants/<id>` */
  base: string;
  /** The item's id: the page makes one for a new item (a second press of Save is a retry, never a second saree). */
  itemId: string;
  /** null = a new saree. */
  item: Item | null;
  role: "owner" | "admin";
  words: TodayWords;
  actions: EditorActions;
  /** The upload route of this saree. */
  uploadUrl: string;
  /** For tests: stand-ins for the network and for the picture shrinker. */
  uploader?: Uploader;
  prepare?: typeof preparePhoto;
  go?: (href: string) => void;
};

const CHECK_CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-edge px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:checked]:font-semibold has-[:checked]:text-brand-text has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:disabled]:opacity-60";
let slotSeq = 0;
/** A key for a row of the tray: only needs to differ from the others on this page. */
const newKey = () => `new-${++slotSeq}`;

/**
 * Add or change a saree (job BC; Owner and Admin). Everything the person chooses is kept in the form until Save; Save then does the work in a fixed order, and says which step it is on:
 *  1. the details (kept hidden if the saree is new or about to be shown, so a saree with no photo is never shown),
 *  2. the new photos, one at a time, each with its own progress bar (a photo that fails is marked and can be tried again; the others still go),
 *  3. the photos taken off, 4. the new order (the first is the cover), 5. "show to customers" last, once a photo is there.
 * The same ids are used on a second try, so nothing doubles. The exact price is the Owner's alone (and needs the second factor): an Admin's form has no price field and sends none, so it stays as it is.
 */
export function ItemEditor(p: ItemEditorProps) {
  const { words, item } = p;
  const router = useRouter();
  const go = p.go ?? ((href: string) => router.push(href));
  const upload = React.useMemo(() => p.uploader ?? uploaderFor(p.uploadUrl), [p.uploader, p.uploadUrl]);
  const prepare = p.prepare ?? preparePhoto;
  const owner = p.role === "owner";

  const [name, setName] = React.useState(item?.name ?? "");
  const [fabric, setFabric] = React.useState<Fabric>(item?.fabric ?? "kanchi_pattu");
  const [colours, setColours] = React.useState<Colour[]>(item?.colours ?? []);
  const [zari, setZari] = React.useState<Zari>(item?.zari ?? "none");
  const [border, setBorder] = React.useState(item?.border ?? "");
  const [occasions, setOccasions] = React.useState<Occasion[]>(item?.occasions ?? []);
  const [band, setBand] = React.useState<PriceBand>(item?.price_band ?? "10k_25k");
  const [stock, setStock] = React.useState<StockStatus>(item?.stock_status ?? "in_stock");
  const [active, setActive] = React.useState(item?.active ?? false);
  const [priceText, setPriceText] = React.useState("");
  const [clearPrice, setClearPrice] = React.useState(false);
  const [slots, setSlots] = React.useState<Slot[]>(() => (item?.photos ?? []).map((ph) => ({ key: ph.id, kind: "saved" as const, photoId: ph.id })));
  const [removed, setRemoved] = React.useState<string[]>([]);
  const [known, setKnown] = React.useState<Map<string, Photo>>(() => new Map((item?.photos ?? []).map((ph) => [ph.id, ph])));
  const [server, setServer] = React.useState<Item | null>(item);
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

  // links from the server's latest read win over the ones held here (they are newer after the page refreshed itself)
  const fromServer = React.useMemo(() => new Map((item?.photos ?? []).map((ph) => [ph.id, ph])), [item]);
  const photoOf = (id: string): Photo | undefined => fromServer.get(id) ?? known.get(id);

  React.useEffect(() => {
    return () => {
      for (const s of slotsRef.current) if (s.kind === "new" && s.preview) URL.revokeObjectURL(s.preview);
    };
  }, []);

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
      // a photo that was already stored on the server (done) must be taken off there too
      if (s.stored) setRemoved((cur) => [...cur, s.stored!.id]);
    } else {
      setRemoved((cur) => [...cur, s.photoId]);
    }
    setSlots((cur) => cur.filter((_, i) => i !== index));
  }

  function whyOf(code: string): string {
    return say(words, photoErrorKey(code));
  }

  function refuse(out: Extract<ItemOutcome, { ok: false }>) {
    setProblem({ text: out.error, ...(out.mfa ? { mfa: true } : {}) });
    setStep(null);
    setBusy(false);
  }

  async function uploadOne(s: Extract<Slot, { kind: "new" }>): Promise<{ ok: true; photos: Photo[] } | { ok: false }> {
    const key = s.key;
    patch(key, { status: "uploading", percent: 0, error: null });
    const prepared = await prepare(s.file);
    if (!prepared.ok) {
      patch(key, { status: "failed", error: whyOf(prepared.code) });
      return { ok: false };
    }
    const out = await upload(prepared.blob, s.photoId, (percent) => patch(key, { percent }));
    if (!out.ok) {
      patch(key, { status: "failed", error: whyOf(out.code) });
      return { ok: false };
    }
    patch(key, { status: "done", percent: 100, stored: out.photo, error: null });
    setKnown((cur) => new Map([...cur, ...out.photos.map((ph) => [ph.id, ph] as const)]));
    return { ok: true, photos: out.photos };
  }

  async function save() {
    if (busy) return;
    setProblem(null);
    setNote(null);
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_NAME) return setProblem({ text: say(words, "catalogue.err.name") });
    if (colours.length < 1 || colours.length > MAX_COLOURS) return setProblem({ text: say(words, "catalogue.err.colours") });
    let price: SaveInput["price"];
    if (owner && clearPrice) price = { clear: true };
    else if (owner && priceText.trim() !== "") {
      const paise = rupeesToPaise(priceText);
      if (paise === null) return setProblem({ text: say(words, "catalogue.err.price") });
      price = { rupees: paise / 100 };
    }
    setBusy(true);
    const base: Omit<SaveInput, "active" | "price"> = { name: trimmed, fabric, colours, zari, border: border.trim() === "" ? null : border.trim(), occasions, priceBand: band, stockStatus: stock };
    const wantShown = showActive;
    const shownNow = server?.active === true && wantShown; // keep it shown only if it already is; otherwise it is shown last, once a photo is there

    setStep(say(words, "catalogue.save.details"));
    const first = await p.actions.save(p.itemId, { ...base, active: shownNow, ...(price ? { price } : {}) });
    if (!first.ok) return refuse(first);
    let current: Item = first.item;
    setServer(current);
    setClearPrice(false);
    setPriceText("");

    // the list as the person left it when they pressed Save: the controls are off while this runs, so it cannot change under us
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
    if (failed > 0) {
      setNote(say(words, "catalogue.saved.partial"));
      return;
    }
    go(`${p.base}/catalogue/${p.itemId}?saved=1`);
  }

  const trayRows: TraySlot[] = slots.map((s) => {
    if (s.kind === "saved") return { key: s.key, src: photoOf(s.photoId)?.thumb_url ?? null, fresh: false, status: "saved", percent: 0, error: null };
    return { key: s.key, src: s.stored?.thumb_url ?? s.preview, fresh: true, status: s.status, percent: s.percent, error: s.error };
  });
  const backHref = item ? `${p.base}/catalogue/${p.itemId}` : `${p.base}/catalogue`;
  const checkBox = "size-5 shrink-0 accent-brand-text";

  return (
    <FreshPhotos seconds={item ? soonestExpiry([item]) : null}>
      <form
        data-screen="catalogue-edit"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex max-w-3xl flex-col gap-5"
      >
        <div>
          <label htmlFor="cat-name" className={label}>
            {say(words, "catalogue.field.name")}
          </label>
          <input id="cat-name" value={name} maxLength={MAX_NAME} disabled={busy} onChange={(e) => setName(e.target.value)} aria-describedby="cat-name-help" className={field} />
          <p id="cat-name-help" className={help}>
            {say(words, "catalogue.form.name.help")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="cat-fabric" className={label}>
              {say(words, "catalogue.field.fabric")}
            </label>
            <select id="cat-fabric" value={fabric} disabled={busy} onChange={(e) => setFabric(e.target.value as Fabric)} className={field}>
              {FABRICS.map((f) => (
                <option key={f} value={f}>
                  {vocab(words, "fabric", f, f)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cat-zari" className={label}>
              {say(words, "catalogue.field.zari")}
            </label>
            <select id="cat-zari" value={zari} disabled={busy} onChange={(e) => setZari(e.target.value as Zari)} className={field}>
              {ZARIS.map((z) => (
                <option key={z} value={z}>
                  {say(words, `catalogue.zari.${z}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{say(words, "catalogue.field.colours")}</legend>
          <div className="flex flex-wrap gap-2">
            {COLOURS.map((c) => (
              <label key={c} className={CHECK_CHIP}>
                <input type="checkbox" className={checkBox} checked={colours.includes(c)} disabled={busy || (!colours.includes(c) && colours.length >= MAX_COLOURS)} onChange={(e) => setColours((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />
                {vocab(words, "colour", c, c)}
              </label>
            ))}
          </div>
          <p className={help}>{say(words, "catalogue.form.colours.help")}</p>
        </fieldset>

        <div>
          <label htmlFor="cat-border" className={label}>
            {say(words, "catalogue.field.border")}
          </label>
          <input id="cat-border" value={border} maxLength={MAX_BORDER} disabled={busy} onChange={(e) => setBorder(e.target.value)} aria-describedby="cat-border-help" className={field} />
          <p id="cat-border-help" className={help}>
            {say(words, "catalogue.form.border.help")}
          </p>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{say(words, "catalogue.field.occasions")}</legend>
          <div className="flex flex-wrap gap-2">
            {OCCASIONS.map((o) => (
              <label key={o} className={CHECK_CHIP}>
                <input type="checkbox" className={checkBox} checked={occasions.includes(o)} disabled={busy || (!occasions.includes(o) && occasions.length >= MAX_OCCASIONS)} onChange={(e) => setOccasions((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))} />
                {vocab(words, "occasion", o, o)}
              </label>
            ))}
          </div>
          <p className={help}>{say(words, "catalogue.form.occasions.help")}</p>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          <div>
            <label htmlFor="cat-band" className={label}>
              {say(words, "catalogue.field.price_band")}
            </label>
            <select id="cat-band" value={band} disabled={busy} onChange={(e) => setBand(e.target.value as PriceBand)} aria-describedby="cat-band-help" className={field}>
              {PRICE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {BAND_WORDS[b]}
                </option>
              ))}
            </select>
            <p id="cat-band-help" className={help}>
              {say(words, "catalogue.form.band.help")}
            </p>
          </div>
          <div>
            <label htmlFor="cat-stock" className={label}>
              {say(words, "catalogue.field.stock")}
            </label>
            <select id="cat-stock" value={stock} disabled={busy} onChange={(e) => setStock(e.target.value as StockStatus)} className={field}>
              {STOCK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {say(words, `catalogue.stock.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div data-part="exact-price" className="rounded-2xl border border-line p-4">
          {owner ? (
            <>
              <label htmlFor="cat-price" className={label}>
                {say(words, "catalogue.field.price")} (₹)
              </label>
              <input id="cat-price" inputMode="decimal" autoComplete="off" value={priceText} disabled={busy || clearPrice} onChange={(e) => setPriceText(e.target.value)} aria-describedby="cat-price-help" className={`${field} max-w-60`} />
              <p id="cat-price-help" className={help}>
                {say(words, "catalogue.form.price.owner")}
              </p>
              {item?.price_text ? (
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-base font-semibold">{say(words, "catalogue.form.price.now", { price: item.price_text })}</p>
                  <label className="flex min-h-11 items-center gap-3 text-base">
                    <input type="checkbox" className={checkBox} checked={clearPrice} disabled={busy} onChange={(e) => setClearPrice(e.target.checked)} />
                    {say(words, "catalogue.form.price.clear")}
                  </label>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{say(words, "catalogue.field.price")}</p>
              <p className="mt-1 text-base">{item?.price_text ?? say(words, "catalogue.field.none")}</p>
              <p className={help}>{say(words, "catalogue.form.price.other")}</p>
            </>
          )}
        </div>

        <section aria-labelledby="cat-photos" className="flex flex-col gap-3">
          <div>
            <h2 id="cat-photos" className="font-display text-xl font-bold">
              {say(words, "catalogue.form.photos")}
            </h2>
            <p className={help}>{say(words, "catalogue.form.photos.help")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || slots.length >= MAX_PHOTOS} onClick={() => takeRef.current?.click()} className={primary}>
              {say(words, "catalogue.photo.take")}
            </button>
            <button type="button" disabled={busy || slots.length >= MAX_PHOTOS} onClick={() => chooseRef.current?.click()} className="inline-flex min-h-11 items-center justify-center rounded-full border border-edge px-[18px] text-[15px] font-semibold hover:bg-surface-2 disabled:opacity-60">
              {say(words, "catalogue.photo.choose")}
            </button>
            <input ref={takeRef} type="file" accept={PHOTO_TYPES.join(",")} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-input="take" onChange={(e) => void addFiles(e.target.files)} />
            <input ref={chooseRef} type="file" accept={PHOTO_TYPES.join(",")} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-input="choose" onChange={(e) => void addFiles(e.target.files)} />
          </div>
          {picked.length ? (
            <ul className={`${errorLine} list-none`} role="alert">
              {picked.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
          {slots.length > 0 ? (
            <PhotoTray
              slots={trayRows}
              words={words}
              name={name.trim() || say(words, "catalogue.new.title")}
              disabled={busy}
              onMove={(from, to) => setSlots((cur) => moveItem(cur, from, to))}
              onRemove={removeAt}
              onRetry={() => void save()}
            />
          ) : null}
        </section>

        <div className="rounded-2xl border border-line p-4">
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input type="checkbox" className="size-6 shrink-0 accent-brand-text" checked={showActive} disabled={busy || liveCount === 0} onChange={(e) => setActive(e.target.checked)} aria-describedby="cat-active-help" />
            {say(words, "catalogue.form.active")}
          </label>
          <p id="cat-active-help" className={help}>
            {liveCount === 0 ? say(words, "catalogue.form.active.needs") : say(words, "catalogue.form.active.help")}
          </p>
        </div>

        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {step ? <p className={okLine}>{step}</p> : null}
          {note ? <p className={okLine}>{note}</p> : null}
        </div>
        {problem ? (
          <div role="alert" className={`${errorLine} flex flex-col gap-1`}>
            <p>{problem.text}</p>
            {problem.mfa ? (
              <Link href="/app/security" className="font-semibold underline">
                {say(words, "today.err.mfa.link")}
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 md:bottom-4">
          <button type="submit" disabled={busy} className={primary}>
            {busy ? say(words, "today.act.working") : say(words, "catalogue.save")}
          </button>
          <Link href={backHref} aria-disabled={busy} className={quiet}>
            {say(words, "today.act.cancel")}
          </Link>
        </div>
      </form>
    </FreshPhotos>
  );
}
