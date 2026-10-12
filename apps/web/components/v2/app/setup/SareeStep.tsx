"use client";

import * as React from "react";

import { COLOURS, FABRICS, PRICE_BANDS, ZARIS, type Colour, type Fabric, type PriceBand, type Zari } from "@/lib/api/catalogue";

import { BAND_WORDS } from "../catalogue/catalogue-logic";
import type { Uploader } from "../catalogue/catalogue-types";
import { photoErrorKey } from "../catalogue/photo-errors";
import { preparePhoto } from "../catalogue/prepare-photo";
import { uploaderFor } from "../catalogue/upload-client";
import { say, type TodayWords } from "../today/today-words";
import { errorLine, field, label, okLine, primary, secondary } from "../visits/styles";
import type { SetupActions } from "./types";

const ZARI_CHIP = "inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-base has-[:checked]:border-brand-edge has-[:checked]:bg-brand-bg has-[:checked]:font-semibold has-[:checked]:text-brand-text";

/** "Maroon Kanchi pattu": a name made from the fabric and the colour, which the person may change. */
export const autoName = (words: TodayWords, fabric: Fabric, colour: Colour): string => `${say(words, `catalogue.colour.${colour}`)} ${say(words, `catalogue.fabric.${fabric}`)}`.slice(0, 120);

/**
 * Step 3 (the AY API): the first saree, with one photo, the fabric and the colour (and the two things the catalogue needs besides: the zari and a price range, as chips and a list). It is the same save as the
 * Catalogue's own form, in the same order: the details first (kept hidden), then the photo (shrunk in the browser, one request to this app's own route), then "shown" last, once a photo is there. The saree's id is
 * made once, so pressing the button twice is a retry and never a second saree. A refusal is said in our words; if only the photo fails the details stay saved and the person is told to choose the photo again.
 */
export function SareeStep({ words, itemId, uploadUrl, save, onAdded, uploader, prepare = preparePhoto }: { words: TodayWords; itemId: string; uploadUrl: string; save: SetupActions["saveItem"]; onAdded: () => void; uploader?: Uploader; prepare?: typeof preparePhoto }) {
  const upload = React.useMemo(() => uploader ?? uploaderFor(uploadUrl), [uploader, uploadUrl]);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [fabric, setFabric] = React.useState<Fabric>("kanchi_pattu");
  const [colour, setColour] = React.useState<Colour>("maroon");
  const [zari, setZari] = React.useState<Zari>("light");
  const [band, setBand] = React.useState<PriceBand>("10k_25k");
  const [name, setName] = React.useState(() => autoName(words, "kanchi_pattu", "maroon"));
  const [named, setNamed] = React.useState(false); // the person wrote their own name: stop filling it in
  const [busy, setBusy] = React.useState(false);
  const [percent, setPercent] = React.useState<number | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const photoId = React.useRef<string>(crypto.randomUUID());
  const detailsSaved = React.useRef(false);

  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const retitle = (f: Fabric, c: Colour) => {
    if (!named) setName(autoName(words, f, c));
  };

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setProblem(null);
    photoId.current = crypto.randomUUID(); // a different photo is a new upload
    e.target.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    if (!file) return setProblem(say(words, "setup.s3.err.photo"));
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 120) return setProblem(say(words, "catalogue.err.name"));
    setProblem(null);
    setBusy(true);
    const base = { name: trimmed, fabric, colours: [colour], zari, border: null, occasions: [], priceBand: band, stockStatus: "in_stock" as const };
    if (!detailsSaved.current) {
      const first = await save(itemId, { ...base, active: false });
      if (!first.ok) {
        setBusy(false);
        return setProblem(first.error);
      }
      detailsSaved.current = true;
    }
    const prepared = await prepare(file);
    if (!prepared.ok) {
      setBusy(false);
      return setProblem(say(words, "setup.s3.photofail", { why: say(words, photoErrorKey(prepared.code)) }));
    }
    setPercent(0);
    const out = await upload(prepared.blob, photoId.current, setPercent);
    setPercent(null);
    if (!out.ok) {
      setBusy(false);
      return setProblem(say(words, "setup.s3.photofail", { why: say(words, photoErrorKey(out.code)) }));
    }
    const shown = await save(itemId, { ...base, active: true });
    setBusy(false);
    if (!shown.ok) return setProblem(shown.error);
    setDone(true);
    onAdded();
  }

  if (done)
    return (
      <p role="status" data-step="saree-done" className={okLine}>
        {say(words, "setup.s3.added")}
      </p>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-step="saree">
      <div>
        <span className={label}>{say(words, "setup.s3.photo")}</span>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-edge bg-surface-2 text-sm text-muted">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo just picked (a blob: address), not a site image
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              say(words, "catalogue.photo.none")
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`${secondary} cursor-pointer`}>
              {file ? say(words, "setup.s3.photo.change") : say(words, "catalogue.photo.choose")}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} disabled={busy} />
            </label>
            <label className={`${secondary} cursor-pointer`}>
              {say(words, "catalogue.photo.take")}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} disabled={busy} />
            </label>
          </div>
        </div>
        <p className="mt-1.5 text-sm text-muted">{say(words, "setup.s3.photo.help")}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="setup-fabric" className={label}>
            {say(words, "catalogue.field.fabric")}
          </label>
          <select
            id="setup-fabric"
            value={fabric}
            onChange={(e) => {
              setFabric(e.target.value as Fabric);
              retitle(e.target.value as Fabric, colour);
            }}
            className={field}
          >
            {FABRICS.map((f) => (
              <option key={f} value={f}>
                {say(words, `catalogue.fabric.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="setup-colour" className={label}>
            {say(words, "setup.s3.colour")}
          </label>
          <select
            id="setup-colour"
            value={colour}
            onChange={(e) => {
              setColour(e.target.value as Colour);
              retitle(fabric, e.target.value as Colour);
            }}
            className={field}
          >
            {COLOURS.map((c) => (
              <option key={c} value={c}>
                {say(words, `catalogue.colour.${c}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset>
        <legend className={label}>{say(words, "catalogue.field.zari")}</legend>
        <div className="flex flex-wrap gap-2">
          {ZARIS.map((z) => (
            <label key={z} className={ZARI_CHIP}>
              <input type="radio" name="zari" className="sr-only" checked={zari === z} onChange={() => setZari(z)} />
              {say(words, `catalogue.zari.${z}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="setup-band" className={label}>
          {say(words, "catalogue.field.price_band")}
        </label>
        <select id="setup-band" value={band} onChange={(e) => setBand(e.target.value as PriceBand)} className={field}>
          {PRICE_BANDS.map((b) => (
            <option key={b} value={b}>
              {BAND_WORDS[b]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-sm text-muted">{say(words, "catalogue.form.band.help")}</p>
      </div>
      <div>
        <label htmlFor="setup-name" className={label}>
          {say(words, "catalogue.field.name")}
        </label>
        <input
          id="setup-name"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setNamed(true);
          }}
          className={field}
        />
      </div>
      {problem ? (
        <p role="alert" className={errorLine}>
          {problem}
        </p>
      ) : null}
      {percent !== null ? (
        <p role="status" className="text-sm text-muted">
          {say(words, "catalogue.photo.uploading", { percent })}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={busy} className={primary}>
          {say(words, "setup.s3.save")}
        </button>
      </div>
    </form>
  );
}
