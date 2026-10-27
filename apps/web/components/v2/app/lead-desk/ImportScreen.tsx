"use client";

import Link from "next/link";
import * as React from "react";

import { consentOf, emptyConsent, type ConsentState } from "@/lib/lead-desk/imports/consent";
import { countsLine, estimateLine } from "@/lib/lead-desk/imports/summary";
import {
  DEFAULT_TAG, FIELD_KEYS, MAX_FILE_BYTES, importTagsFor, mappingHasContact, rupeesToPaise,
  type Failure, type Field, type ImportBody, type ImportResult, type Mapping, type Out, type PreviewBody, type PreviewResult, type ReadBody, type ReadKind, type ReadResult, type SheetAccess, type SheetLink, type SheetLinkBody, type SourceTag,
} from "@/lib/lead-desk/imports/types";

import { Pill } from "../parts";
import { alertBox, btnMain, btnQuiet, dataTable, dataTd, dataThCol, dataTr, fieldHelp, fieldInput, fieldLabel, fieldTextarea, listPlain, mutedText, noteBox, okBox, pageH3, surface, tableWrap, warnBox } from "../ui";
import { indiaClock, indiaDay } from "../today/time";
import { makeT, type Words } from "../words";
import { ConsentFacts } from "./ConsentFacts";
import { FailureNote } from "./FailureNote";

type Action<T> = (input: unknown) => Promise<Out<T>>;
export type ImportActions = {
  read: Action<ReadResult>;
  preview: Action<PreviewResult>;
  import: Action<ImportResult>;
  createLink: Action<SheetLink>;
  linkAct: (linkId: string, what: "sync" | "pause" | "resume") => Promise<Out<SheetLink>>;
};
export type ImportScreenProps = {
  words: Words;
  /** `/app/tenants/{id}` */
  base: string;
  role: "owner" | "admin" | "sales";
  test: boolean;
  /** Where a FILE goes (a server action's body is too small for 3 MB): `/app/tenants/{id}/import/send`. */
  fileEndpoint: string;
  actions: ImportActions;
  /** The ways to share a sheet and the sheets kept in sync (Owner and Admin); null = could not be loaded or not for this role. */
  sheets: { access: SheetAccess; links: SheetLink[] } | null;
};

const KINDS: readonly ReadKind[] = ["file", "sheet", "paste", "vcard"];
const READ_ERR = "down" as const;
const whenOf = (iso: string) => `${indiaDay(iso)} ${indiaClock(iso)}`;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const at = url.indexOf("base64,");
      if (at < 0) reject(new Error("read"));
      else resolve(url.slice(at + 7));
    };
    reader.readAsDataURL(file);
  });
}

/** The words of a Failure the server answered with: only a closed word is trusted from the network. */
function failureFrom(v: unknown): Failure {
  const r = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const error = typeof r.error === "string" && /^[a-z_]{1,40}$/.test(r.error) ? r.error : READ_ERR;
  const reason = typeof r.reason === "string" && /^[a-z_]{1,30}$/.test(r.reason) ? r.reason : undefined;
  return { ok: false, error: error as Failure["error"], ...(reason ? { reason: reason as Failure["reason"] } : {}) };
}

/**
 * THE IMPORT SCREEN (night 4, Lead Desk, item 3). One page, in the order a person does it: choose where the list is (an Excel or CSV file dropped or chosen, a Google Sheet link, a pasted list, a .vcf contacts file) ->
 * the columns (what we guessed, each with three sample values, the person confirms) -> the consent confirmation (Owner and Admin) -> where the leads came from and what they cost -> a plain preview line with the estimate and
 * the first problems -> Add. Then the result and two ways on. The file is read in this browser to base64 (3 MB at most) and posted with each step; nothing is kept between the steps. A retry of the same import is safe: the
 * `import_id` is made once for the same content. Test mode says so; the calls are the server actions, a file goes through the route in `fileEndpoint`.
 */
export function ImportScreen({ words, base, role, test, fileEndpoint, actions, sheets }: ImportScreenProps) {
  const t = makeT(words);
  const canConfirm = role === "owner" || role === "admin";
  const [kind, setKind] = React.useState<ReadKind>("file");
  const [file, setFile] = React.useState<{ name: string; b64: string } | null>(null);
  const [fileNote, setFileNote] = React.useState<null | "big" | "fail">(null);
  const [dragging, setDragging] = React.useState(false);
  const [text, setText] = React.useState("");
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [keep, setKeep] = React.useState(false);
  const [read, setRead] = React.useState<ReadResult | null>(null);
  const [choice, setChoice] = React.useState<(Field | null)[]>([]);
  const [consent, setConsent] = React.useState<ConsentState>(emptyConsent);
  const [source, setSource] = React.useState<SourceTag>(DEFAULT_TAG.file);
  const [cost, setCost] = React.useState("");
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);
  const [result, setResult] = React.useState<{ source: string; counts: ImportResult["counts"] | null; kept: boolean } | null>(null);
  const [busy, setBusy] = React.useState<null | "read" | "check" | "import">(null);
  const [failure, setFailure] = React.useState<(Failure & { at: "read" | "check" | "import" | "link" }) | null>(null);
  const [links, setLinks] = React.useState<SheetLink[]>(sheets?.links ?? []);
  const [linkNote, setLinkNote] = React.useState<{ id: string; text: string } | null>(null);
  const importId = React.useRef<{ key: string; id: string } | null>(null);
  const linkId = React.useRef<string | null>(null);

  const tabular = kind === "file" || kind === "sheet";
  const mapping: Mapping | null = React.useMemo(() => {
    if (!read || !tabular) return null;
    const m: Mapping = {};
    choice.forEach((f, i) => {
      if (f) m[f] = i;
    });
    return m;
  }, [read, tabular, choice]);
  const consentValue = consentOf(consent);
  const costPaise = rupeesToPaise(cost);
  const costBad = costPaise === null;
  const ready = read !== null && (!tabular || mappingHasContact(mapping)) && consentValue !== "incomplete" && !costBad;

  // anything that changes what would be sent makes the earlier check stale
  const stale = () => {
    setPreview(null);
    setResult(null);
    setFailure(null);
  };
  const restart = (next: ReadKind) => {
    setKind(next);
    setRead(null);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setSource(DEFAULT_TAG[next]);
    setFileNote(null);
  };

  const readBody = (): ReadBody => ({
    kind,
    filename: kind === "file" || kind === "vcard" ? (file?.name ?? null) : null,
    content_base64: (kind === "file" || kind === "vcard") && file ? file.b64 : null,
    text: kind === "paste" ? text : null,
    sheet_url: kind === "sheet" ? sheetUrl.trim() : null,
    use_ai: true,
  });
  const previewBody = (): PreviewBody => ({ ...readBody(), mapping, source: kind === "sheet" && keep ? "google_sheet" : source, consent_confirmed: consentValue !== null && consentValue !== "incomplete" });

  /** A file is posted to the route (it is too big for a server action); everything else goes through the server actions. */
  async function send<T>(step: "read" | "preview" | "import", body: unknown, action: Action<T>): Promise<Out<T>> {
    try {
      if (kind === "file") {
        const response = await fetch(`${fileEndpoint}/${step}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json: unknown = await response.json().catch(() => null);
        if (typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true) return { ok: true, data: (json as { data: T }).data };
        return failureFrom(json);
      }
      return await action(body);
    } catch {
      return { ok: false, error: READ_ERR };
    }
  }

  async function onFile(f: File | null | undefined) {
    if (!f) return;
    setFileNote(null);
    setRead(null);
    stale();
    if (f.size > MAX_FILE_BYTES) {
      setFile(null);
      setFileNote("big");
      return;
    }
    try {
      setFile({ name: f.name, b64: await toBase64(f) });
    } catch {
      setFile(null);
      setFileNote("fail");
    }
  }

  async function doRead() {
    setBusy("read");
    setFailure(null);
    setPreview(null);
    setResult(null);
    const out = await send("read", readBody(), actions.read);
    setBusy(null);
    if (!out.ok) {
      setRead(null);
      setFailure({ ...out, at: "read" });
      return;
    }
    setRead(out.data);
    setChoice(out.data.columns.map((c) => c.field));
    importId.current = null;
  }

  async function doCheck() {
    setBusy("check");
    setFailure(null);
    const out = await send("preview", previewBody(), actions.preview);
    setBusy(null);
    if (!out.ok) setFailure({ ...out, at: "check" });
    else setPreview(out.data);
  }

  async function doImport() {
    if (!preview) return;
    const consentBody = consentValue === "incomplete" ? null : consentValue;
    const body: ImportBody = { ...previewBody(), import_id: "", consent: consentBody, cost_per_lead_paise: typeof costPaise === "number" ? costPaise : null };
    // the same content keeps the same id, so a retry after a dropped connection cannot add the list twice
    const key = JSON.stringify({ ...body, import_id: "" });
    if (!importId.current || importId.current.key !== key) importId.current = { key, id: crypto.randomUUID() };
    body.import_id = importId.current.id;
    setBusy("import");
    setFailure(null);
    const out = await send("import", body, actions.import);
    setBusy(null);
    if (!out.ok) setFailure({ ...out, at: "import" });
    else setResult({ source: out.data.source, counts: out.data.counts, kept: false });
  }

  async function doKeep() {
    if (!mapping || !mappingHasContact(mapping)) return;
    if (!linkId.current) linkId.current = crypto.randomUUID();
    const body: SheetLinkBody = { link_id: linkId.current, sheet_url: sheetUrl.trim(), mapping, consent: consentValue === "incomplete" ? null : consentValue, cost_per_lead_paise: typeof costPaise === "number" ? costPaise : null };
    setBusy("import");
    setFailure(null);
    let out: Out<SheetLink>;
    try {
      out = await actions.createLink(body);
    } catch {
      out = { ok: false, error: READ_ERR };
    }
    setBusy(null);
    if (!out.ok) return setFailure({ ...out, at: "import" });
    setLinks((l) => [out.data, ...l.filter((x) => x.id !== out.data.id)]);
    setResult({ source: "google_sheet", counts: null, kept: true });
  }

  async function actOnLink(id: string, what: "sync" | "pause" | "resume") {
    setLinkNote(null);
    let out: Out<SheetLink>;
    try {
      out = await actions.linkAct(id, what);
    } catch {
      out = { ok: false, error: READ_ERR };
    }
    if (!out.ok) return setFailure({ ...out, at: "link" });
    setLinks((l) => l.map((x) => (x.id === id ? out.data : x)));
    if (what === "sync") setLinkNote({ id, text: t("li.link.queued") });
  }

  const again = () => {
    restart(kind);
    setFile(null);
    setText("");
    setSheetUrl("");
    setCost("");
    setConsent(emptyConsent());
    setKeep(false);
    importId.current = null;
    linkId.current = null;
  };

  const line = preview ? countsLine(preview.counts, t) : "";
  const estimate = preview ? estimateLine(preview.estimate, t) : null;
  const doneLine = result?.counts ? countsLine(result.counts, t) : "";

  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-6">
      {test ? (
        <p role="note" className={noteBox + " !mt-0"}>
          {t("li.mock")}
        </p>
      ) : null}

      <section aria-labelledby="li-src" className={surface}>
        <h2 id="li-src" className={pageH3 + " !mt-0"}>
          {t("li.src.title")}
        </h2>
        <div role="radiogroup" aria-labelledby="li-src" className="mt-3 flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => restart(k)} className={`min-h-11 rounded-full border px-4 text-base font-semibold ${kind === k ? "border-brand-edge bg-brand-bg text-brand-text" : "border-edge bg-surface text-muted hover:bg-surface-2"}`}>
              {t(`li.src.${k}`)}
            </button>
          ))}
        </div>

        {kind === "file" || kind === "vcard" ? (
          <div className="mt-4">
            <div
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void onFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? "border-brand-edge bg-brand-bg" : "border-edge bg-surface-2"}`}
            >
              <p className="text-base">{t("li.file.drop")}</p>
              <label htmlFor="li-file" className={btnQuiet + " cursor-pointer"}>
                {kind === "vcard" ? t("li.vcf.choose") : t("li.file.choose")}
              </label>
              <input id="li-file" type="file" className="sr-only" accept={kind === "vcard" ? ".vcf,text/vcard,text/x-vcard" : ".csv,.tsv,.txt,.xlsx,.xls,text/csv"} onChange={(e) => void onFile(e.target.files?.[0])} />
              <p className={fieldHelp + " !mt-0"}>{kind === "vcard" ? t("li.vcf.hint") : t("li.file.hint")}</p>
              {file ? <p className="font-semibold [overflow-wrap:anywhere]">{t("li.file.picked", { name: file.name })}</p> : null}
            </div>
            {fileNote ? (
              <p role="alert" className={alertBox}>
                {t(fileNote === "big" ? "li.file.big" : "li.file.fail")}
              </p>
            ) : null}
          </div>
        ) : null}

        {kind === "paste" ? (
          <div className="mt-4">
            <label htmlFor="li-paste" className={fieldLabel}>
              {t("li.paste.label")}
            </label>
            <textarea id="li-paste" rows={8} className={fieldTextarea} value={text} onChange={(e) => (setText(e.target.value), setRead(null), stale())} placeholder={"Ravi, 90000 00001\nAnitha, 90000 00002"} />
            <p className={fieldHelp}>{t("li.paste.hint")}</p>
          </div>
        ) : null}

        {kind === "sheet" ? (
          <div className="mt-4 flex flex-col gap-3">
            <div>
              <label htmlFor="li-sheet" className={fieldLabel}>
                {t("li.sheet.url")}
              </label>
              <input id="li-sheet" type="url" inputMode="url" className={fieldInput} value={sheetUrl} onChange={(e) => (setSheetUrl(e.target.value), setRead(null), stale())} placeholder="https://docs.google.com/spreadsheets/d/..." />
            </div>
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <p className="font-semibold">{t("li.sheet.how")}</p>
              <ul className="mt-1 list-disc pl-5">
                {(sheets?.access.modes ?? [{ mode: "anyone_with_link", available: true, service_account_email: null }, { mode: "published_csv", available: true, service_account_email: null }, { mode: "service_account", available: false, service_account_email: null }]).map((m) => (
                  <li key={m.mode}>{m.mode === "service_account" ? (m.available && m.service_account_email ? t("li.sheet.mode.service_account.on", { email: m.service_account_email }) : t("li.sheet.mode.service_account.off")) : t(`li.sheet.mode.${m.mode}`)}</li>
                ))}
              </ul>
            </div>
            {canConfirm ? (
              <fieldset className="flex flex-col gap-1 border-0 p-0">
                <label className="flex min-h-11 items-center gap-3 text-base">
                  <input type="radio" name="li-sync" className="size-6 accent-brand-text" checked={!keep} onChange={() => (setKeep(false), stale())} />
                  {t("li.sheet.once")}
                </label>
                <label className="flex min-h-11 items-center gap-3 text-base">
                  <input type="radio" name="li-sync" className="size-6 accent-brand-text" checked={keep} onChange={() => (setKeep(true), stale())} />
                  {t("li.sheet.keep")}
                </label>
              </fieldset>
            ) : (
              <p className={fieldHelp + " !mt-0"}>{t("li.sheet.keep.owner")}</p>
            )}
          </div>
        ) : null}

        <div className="mt-4">
          <button type="button" className={btnMain} disabled={busy !== null || (kind === "paste" ? text.trim() === "" : kind === "sheet" ? sheetUrl.trim() === "" : file === null)} onClick={() => void doRead()}>
            {busy === "read" ? t("li.reading") : t("li.read")}
          </button>
        </div>
        {failure?.at === "read" ? <FailureNote words={words} failure={failure} /> : null}
      </section>

      {read ? (
        <>
          <section aria-labelledby="li-map" className={surface}>
            <h2 id="li-map" className={pageH3 + " !mt-0"}>
              {tabular ? t("li.map.title") : t("li.read.leads", { n: read.rows })}
            </h2>
            {tabular ? (
              <>
                <p className={mutedText + " !mt-1"}>
                  {t("li.read.found", { n: read.rows })} {t("li.map.hint")}
                </p>
                {read.mapped_by === "rules+ai" ? <p className={fieldHelp}>{t("li.map.ai")}</p> : null}
                {read.warnings.map((w) => (
                  <p key={w} className={fieldHelp}>
                    {t(`li.warn.${w}`)}
                  </p>
                ))}
                <div className={tableWrap}>
                  <table className={dataTable}>
                    <thead>
                      <tr>
                        <th scope="col" className={dataThCol}>
                          {t("li.map.col")}
                        </th>
                        <th scope="col" className={dataThCol}>
                          {t("li.map.samples")}
                        </th>
                        <th scope="col" className={dataThCol}>
                          {t("li.map.means")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {read.columns.map((c, i) => (
                        <tr key={c.index} className={dataTr}>
                          <td className={dataTd + " font-semibold [overflow-wrap:anywhere]"} data-label={t("li.map.col")}>
                            {c.header || t("li.map.empty")}
                          </td>
                          <td className={dataTd + " text-muted [overflow-wrap:anywhere]"} data-label={t("li.map.samples")}>
                            {c.samples.filter((s) => s !== "").join(" · ") || t("li.map.empty")}
                          </td>
                          <td className={dataTd} data-label={t("li.map.means")}>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                aria-label={`${t("li.map.means")}: ${c.header}`}
                                className={fieldInput + " !w-auto min-w-44"}
                                value={choice[i] ?? ""}
                                onChange={(e) => {
                                  const f = (e.target.value || null) as Field | null;
                                  setChoice((old) => old.map((x, j) => (j === i ? f : f !== null && x === f ? null : x)));
                                  stale();
                                }}
                              >
                                <option value="">{t("li.field.ignore")}</option>
                                {FIELD_KEYS.map((f) => (
                                  <option key={f} value={f}>
                                    {t(`li.field.${f}`)}
                                  </option>
                                ))}
                              </select>
                              <Pill tone={c.confidence === "exact" ? "green" : c.confidence === "partial" ? "info" : c.confidence === "weak" ? "amber" : c.confidence === "ai" ? "brand" : "neutral"}>{t(`li.map.conf.${c.confidence}`)}</Pill>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!mappingHasContact(mapping) ? (
                  <p role="alert" className={warnBox}>
                    {t("li.map.need")}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          <section aria-labelledby="li-consent" className={surface}>
            <h2 id="li-consent" className="sr-only">
              {t("li.consent.title")}
            </h2>
            <ConsentFacts words={words} state={consent} onChange={(c) => (setConsent(c), stale())} canConfirm={canConfirm} idPrefix="li-consent" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="li-source" className={fieldLabel}>
                  {t("li.source.title")}
                </label>
                <select id="li-source" className={fieldInput} value={source} onChange={(e) => (setSource(e.target.value as SourceTag), stale())} disabled={kind === "sheet" && keep}>
                  {importTagsFor(kind).map((tag) => (
                    <option key={tag} value={tag}>
                      {t(`li.tag.${tag}`)}
                    </option>
                  ))}
                </select>
                <p className={fieldHelp}>{t("li.source.hint")}</p>
              </div>
              <div>
                <label htmlFor="li-cost" className={fieldLabel}>
                  {t("li.cost.label")}
                </label>
                <input id="li-cost" inputMode="decimal" className={fieldInput + (costBad ? " border-red-text" : "")} value={cost} aria-invalid={costBad} onChange={(e) => (setCost(e.target.value), stale())} />
                <p className={fieldHelp}>{costBad ? t("li.cost.bad") : t("li.cost.hint")}</p>
              </div>
            </div>
            <div className="mt-4">
              <button type="button" className={btnMain} disabled={!ready || busy !== null} onClick={() => void doCheck()}>
                {busy === "check" ? t("li.checking") : t("li.check")}
              </button>
            </div>
            {failure?.at === "check" ? <FailureNote words={words} failure={failure} /> : null}
          </section>
        </>
      ) : null}

      {preview && !result ? (
        <section aria-labelledby="li-preview" className={surface}>
          <h2 id="li-preview" className={pageH3 + " !mt-0"}>
            {t("li.pv.title")}
          </h2>
          <p className="mt-2 text-lg font-semibold">{line}</p>
          {estimate ? (
            <p className="mt-1 text-base">
              {estimate} <span className="text-sm text-muted">{t("li.pv.estimate.note")}</span>
            </p>
          ) : null}
          {preview.dnd_lookup === "not_configured" ? <p className={fieldHelp}>{t("li.pv.dnd_off")}</p> : null}
          {preview.counts.blocked > 0 || preview.problems.some((p) => p.reason === "real_data_gate") ? (
            <p role="note" className={warnBox}>
              {t("li.problem.real_data_gate")}
            </p>
          ) : null}
          {preview.problems.length > 0 ? (
            <>
              <h3 className="mt-4 text-base font-semibold">{t("li.pv.problems")}</h3>
              <ul className={listPlain + " !mt-1 !gap-1"}>
                {preview.problems.slice(0, 8).map((p) => (
                  <li key={`${p.row}-${p.reason}`} className="text-base">
                    <span className="font-semibold">{t("li.pv.row", { n: p.row })}</span>: {t(`li.problem.${p.reason}`) === `li.problem.${p.reason}` ? t("li.problem.row_refused") : t(`li.problem.${p.reason}`)}
                  </li>
                ))}
              </ul>
              {preview.problems.length > 8 ? <p className={fieldHelp}>{t("li.pv.more", { n: preview.problems.length - 8 })}</p> : null}
            </>
          ) : null}
          {preview.counts.ready === 0 ? <p className={warnBox}>{t("li.pv.nothing")}</p> : null}
          <div className="mt-4">
            {kind === "sheet" && keep ? (
              <button type="button" className={btnMain} disabled={busy !== null || preview.counts.ready === 0} onClick={() => void doKeep()}>
                {busy === "import" ? t("li.keeping") : t("li.keep")}
              </button>
            ) : (
              <button type="button" className={btnMain} disabled={busy !== null || preview.counts.ready === 0} onClick={() => void doImport()}>
                {busy === "import" ? t("li.importing") : t("li.import")}
              </button>
            )}
          </div>
          {failure?.at === "import" ? <FailureNote words={words} failure={failure} /> : null}
        </section>
      ) : null}

      {result ? (
        <section aria-labelledby="li-done" className={surface}>
          <div role="status" className={okBox + " !mt-0"}>
            <h2 id="li-done" className="font-display text-xl font-bold">
              {t("li.done.title")}
            </h2>
            <p className="mt-1">{result.kept ? t("li.done.kept") : doneLine}</p>
          </div>
          <p className={mutedText}>{t("li.next.hint")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href={`${base}/outreach/new?source=${encodeURIComponent(result.source)}`} className={btnMain}>
              {t("li.next.campaign")}
            </Link>
            <Link href={`${base}/tasks?new=1`} className={btnQuiet}>
              {t("li.next.assistant")}
            </Link>
            <button type="button" className={btnQuiet} onClick={again}>
              {t("li.again")}
            </button>
          </div>
        </section>
      ) : null}

      {canConfirm && sheets ? (
        <section aria-labelledby="li-links" className={surface} id="sheets">
          <h2 id="li-links" className={pageH3 + " !mt-0"}>
            {t("li.links.title")}
          </h2>
          {links.length === 0 ? (
            <p className={mutedText}>{t("li.links.empty")}</p>
          ) : (
            <ul className={listPlain}>
              {links.map((l) => (
                <li key={l.id} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{t("li.link.name", { when: whenOf(l.created_at) })}</p>
                    <Pill tone={l.status === "active" ? "green" : l.status === "paused" ? "neutral" : "amber"}>{t(`li.link.status.${l.status}`)}</Pill>
                  </div>
                  <p className="mt-1 text-sm text-muted">{l.last_synced_at ? t("li.link.last", { when: whenOf(l.last_synced_at), n: l.last_row_count ?? 0 }) : t("li.link.never")}</p>
                  {l.last_error ? (
                    <p role="alert" className="mt-1 text-sm font-semibold text-amber-text">
                      {t(`li.link.err.${l.last_error}`)}
                    </p>
                  ) : null}
                  {linkNote?.id === l.id ? (
                    <p role="status" className="mt-1 text-sm">
                      {linkNote.text}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={btnQuiet} onClick={() => void actOnLink(l.id, "sync")}>
                      {t("li.link.sync")}
                    </button>
                    {l.status === "paused" ? (
                      <button type="button" className={btnQuiet} onClick={() => void actOnLink(l.id, "resume")}>
                        {t("li.link.resume")}
                      </button>
                    ) : (
                      <button type="button" className={btnQuiet} onClick={() => void actOnLink(l.id, "pause")}>
                        {t("li.link.pause")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {failure?.at === "link" ? <FailureNote words={words} failure={failure} /> : null}
        </section>
      ) : null}
    </div>
  );
}
