"use client";

import * as React from "react";

import { FILE_ACCEPT, FILE_MAX_BYTES, NOTES_MAX, VOICE_MAX_SECONDS, type ContextError, type ContextState, type Done, type TestAnswer, type Understood, type VersionItem } from "@/lib/context/types";

import { alertBox, btnMain, btnQuiet, fieldHelp, fieldLabel, fieldTextarea, okBox, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";
import { makePost, type Post } from "./context-post";

const SAVE_AFTER_MS = 1200;
type Save = "saved" | "saving" | "unsaved" | "changed";
const SECTION_KEYS = ["prices", "delivery", "timings", "payment", "always_say", "never_say", "discounts", "handover", "tone", "faq", "products", "other"];

/** base64 of a file or recording, without the data: prefix */
const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(blob);
  });

/**
 * Settings > AI assistant > "About my business" (job context-and-easy-sources part A, contract-context-sources.md): one big box the assistant reads in chats, calls, Ask and drafts, like briefing a new employee. It saves by itself a moment after the person stops typing
 * (with the version it started from: if someone else saved first, the person chooses between theirs and "keep mine"); gentle headings to tap when they do not know what to write; "Add from something you already have" (paste, a file up to 3 MB, or a
 * voice note up to 2 minutes) which first shows "Here is what I understood", editable, saved only when the person says so (add to my notes, or replace); "Try it", which answers a customer's question from the saved notes and says when it would wait for the owner;
 * and the earlier versions, any of which can be brought back as a NEW version. Read by every member, changed by the Owner and Admins only (the screen is read-only for others). Calls go to this app's own route (`endpoint`), never the API.
 */
export function AboutBusiness({ words, initial, endpoint, canEdit, lang, sourcesHref, post: given }: { words?: Words; initial: ContextState; endpoint: string; canEdit: boolean; lang: string; sourcesHref: string; post?: Post }) {
  const t = makeT(words);
  const post = React.useMemo(() => given ?? makePost(endpoint), [given, endpoint]);
  const [notes, setNotes] = React.useState(initial.notes);
  const [meta, setMeta] = React.useState({ version: initial.version, updatedAt: initial.updatedAt, by: initial.updatedBy?.name ?? null });
  const [save, setSave] = React.useState<Save>("saved");
  const [problem, setProblem] = React.useState<ContextError | null>(null);
  const live = React.useRef({ notes: initial.notes, version: initial.version, timer: null as ReturnType<typeof setTimeout> | null, busy: false });
  const sentence = (e: ContextError) => t(`ctx.err.${e === "changed" ? "down" : e}` as "ctx.err.down");

  const apply = (state: ContextState) => {
    live.current.version = state.version;
    live.current.notes = state.notes;
    setNotes(state.notes);
    setMeta({ version: state.version, updatedAt: state.updatedAt, by: state.updatedBy?.name ?? null });
    setSave("saved");
    setProblem(null);
  };

  const flush = async () => {
    const l = live.current;
    if (l.busy) return; // the one in flight ends by looking again
    l.busy = true;
    setSave("saving");
    const sent = l.notes;
    const r = await post({ op: "put", notes: sent, version: l.version });
    l.busy = false;
    if (r.ok) {
      l.version = r.data.version;
      setMeta({ version: r.data.version, updatedAt: r.data.updatedAt, by: r.data.updatedBy?.name ?? null });
      setProblem(null);
      if (l.notes !== sent) void flush(); // typed more meanwhile
      else setSave("saved");
    } else if (r.error === "changed") setSave("changed");
    else {
      setProblem(r.error);
      setSave("unsaved");
    }
  };
  const typed = (text: string) => {
    const l = live.current;
    l.notes = text;
    setNotes(text);
    setSave("unsaved");
    if (l.timer) clearTimeout(l.timer);
    l.timer = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };
  React.useEffect(() => () => void (live.current.timer && clearTimeout(live.current.timer)), []);

  const showTheirs = async () => {
    const r = await post({ op: "get" });
    if (r.ok) apply(r.data);
    else setProblem(r.error);
  };
  const keepMine = async () => {
    const r = await post({ op: "get" });
    if (!r.ok) return setProblem(r.error);
    live.current.version = r.data.version; // theirs is in the versions list; mine goes on top
    void flush();
  };
  const addHeading = (label: string) => typed(`${notes.trimEnd()}${notes.trim() ? "\n\n" : ""}## ${label}\n`);

  // ---- add from paste / file / voice -> preview -> save
  const [add, setAdd] = React.useState<null | "paste" | "file" | "voice">(null);
  const [pasted, setPasted] = React.useState("");
  const [reading, setReading] = React.useState(false);
  const [addProblem, setAddProblem] = React.useState<ContextError | "nomic" | null>(null);
  const [preview, setPreview] = React.useState<Understood | null>(null);
  const [edited, setEdited] = React.useState("");
  const [mode, setMode] = React.useState<"append" | "replace">("append");
  const understood = (r: Done<Understood>) => {
    setReading(false);
    if (!r.ok) return setAddProblem(r.error);
    setAddProblem(null);
    setPreview(r.data);
    setEdited(r.data.notesMarkdown);
    setMode(notes.trim() === "" ? "replace" : "append");
  };
  const readPaste = async () => {
    setReading(true);
    understood(await post({ op: "understand", kind: "paste", text: pasted.slice(0, NOTES_MAX), language: lang }));
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) return setAddProblem("toolarge");
    setReading(true);
    try {
      understood(await post({ op: "understand", kind: "file", filename: file.name.slice(0, 200), contentBase64: await toBase64(file), language: lang }));
    } catch {
      setReading(false);
      setAddProblem("unreadable");
    }
  };
  const [recording, setRecording] = React.useState(false);
  const rec = React.useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream; timer: ReturnType<typeof setTimeout> } | null>(null);
  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        setRecording(false);
        if (rec.current) clearTimeout(rec.current.timer);
        rec.current = null;
        setReading(true);
        try {
          understood(await post({ op: "understand", kind: "voice", filename: "voice.webm", contentBase64: await toBase64(new Blob(chunks, { type: recorder.mimeType })), language: lang }));
        } catch {
          setReading(false);
          setAddProblem("unreadable");
        }
      };
      recorder.start();
      rec.current = { recorder, chunks, stream, timer: setTimeout(() => recorder.state === "recording" && recorder.stop(), VOICE_MAX_SECONDS * 1000) };
      setRecording(true);
      setAddProblem(null);
    } catch {
      setAddProblem("nomic");
    }
  };
  const stopVoice = () => rec.current?.recorder.state === "recording" && rec.current.recorder.stop();
  React.useEffect(
    () => () => {
      if (rec.current) {
        clearTimeout(rec.current.timer);
        rec.current.stream.getTracks().forEach((x) => x.stop());
      }
    },
    [],
  );
  const savePreview = async () => {
    if (!preview) return;
    const r = await post({ op: "save", previewId: preview.previewId, notes: edited, mode, version: live.current.version });
    if (r.ok) {
      apply(r.data);
      setPreview(null);
      setAdd(null);
      setPasted("");
    } else setAddProblem(r.error === "changed" ? "changed" : r.error);
  };

  // ---- try it
  const [question, setQuestion] = React.useState("");
  const [asking, setAsking] = React.useState(false);
  const [answer, setAnswer] = React.useState<Done<TestAnswer> | null>(null);
  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    if (live.current.timer) {
      clearTimeout(live.current.timer);
      await flush(); // the test reads the SAVED notes
    }
    setAnswer(await post({ op: "test", question: question.trim(), language: lang }));
    setAsking(false);
  };

  // ---- versions
  const [versions, setVersions] = React.useState<Done<VersionItem[]> | null>(null);
  const loadVersions = async () => setVersions(await post({ op: "versions" }));
  const restore = async (v: number) => {
    const r = await post({ op: "restore", version: v });
    if (r.ok) {
      apply(r.data);
      void loadVersions();
    } else setProblem(r.error);
  };

  const headings = initial.prompts.map((p) => ({ key: p.key, label: SECTION_KEYS.includes(p.key) ? t(`ctx.sec.${p.key}` as "ctx.sec.prices") : p.label }));
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "");
  const stateLine = save === "saving" ? t("ctx.saving") : save === "unsaved" ? t("ctx.unsaved") : save === "saved" ? t("ctx.saved") : "";

  return (
    <section className={`${surface} flex flex-col gap-4`} aria-labelledby="ctx-h" data-part="about-business">
      <header className="flex flex-col gap-1">
        <h2 id="ctx-h" className="text-lg font-semibold text-ink">{t("ctx.title")}</h2>
        <p className="text-sm text-muted">{t("ctx.lead")}</p>
        {initial.usedBy.length > 0 ? <p className={fieldHelp}>{t("ctx.used")} {initial.usedBy.map((u) => t(`ctx.used.${u}` as "ctx.used.chats")).join(", ")}</p> : null}
      </header>

      {!canEdit ? <p className={warnBox}>{t("ctx.err.forbidden")}</p> : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="ctx-notes" className={fieldLabel}>{t("ctx.notes")}</label>
        <textarea id="ctx-notes" value={notes} readOnly={!canEdit} maxLength={NOTES_MAX} rows={12} placeholder={t("ctx.ph")} onChange={(e) => typed(e.target.value)} className={`${fieldTextarea} min-h-60 font-sans`} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted" aria-live="polite">
          <span data-save={save}>{stateLine}{meta.by && save === "saved" ? ` · ${t("ctx.ver.by", { name: meta.by })}${meta.updatedAt ? `, ${when(meta.updatedAt)}` : ""}` : ""}</span>
          <span>{t("ctx.count", { n: notes.length.toLocaleString(lang) })}</span>
        </div>
        {save === "changed" ? (
          <div className={`${warnBox} flex flex-col gap-2`} role="alert">
            <p>{t("ctx.changed")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnQuiet} onClick={() => void showTheirs()}>{t("ctx.changed.load")}</button>
              <button type="button" className={btnMain} onClick={() => void keepMine()}>{t("ctx.changed.keep")}</button>
            </div>
          </div>
        ) : null}
        {problem ? <p className={alertBox} role="alert">{sentence(problem)}</p> : null}
      </div>

      {canEdit && headings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className={fieldHelp}>{t("ctx.prompts")}</p>
          <div className="flex flex-wrap gap-2">
            {headings.map((h) => (
              <button key={h.key} type="button" onClick={() => addHeading(h.label)} className="min-h-11 rounded-full border border-edge bg-surface px-4 text-sm font-semibold text-muted hover:bg-surface-2">
                {h.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-col gap-3 border-t border-edge pt-4">
          <h3 className="text-base font-semibold text-ink">{t("ctx.add")}</h3>
          <div className="flex flex-wrap gap-2">
            {(["paste", "file", "voice"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={add === k} onClick={() => { setAdd(add === k ? null : k); setPreview(null); setAddProblem(null); }} className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${add === k ? "border-ink bg-ink text-bg" : "border-edge bg-surface text-muted hover:bg-surface-2"}`}>
                {t(`ctx.add.${k}` as "ctx.add.paste")}
              </button>
            ))}
          </div>
          {add === "paste" && !preview ? (
            <div className="flex flex-col gap-2">
              <textarea aria-label={t("ctx.add.paste")} value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} maxLength={NOTES_MAX} placeholder={t("ctx.add.paste.ph")} className={fieldTextarea} />
              <div><button type="button" className={btnMain} disabled={reading || !pasted.trim()} onClick={() => void readPaste()}>{reading ? t("ctx.add.reading") : t("ctx.add.read")}</button></div>
            </div>
          ) : null}
          {add === "file" && !preview ? (
            <div className="flex flex-col gap-2">
              <input type="file" accept={FILE_ACCEPT} aria-label={t("ctx.add.file")} disabled={reading} onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ""; }} className="text-sm" />
              <p className={fieldHelp}>{reading ? t("ctx.add.reading") : t("ctx.add.file.hint")}</p>
            </div>
          ) : null}
          {add === "voice" && !preview ? (
            <div className="flex flex-col gap-2">
              <div>
                {recording ? (
                  <button type="button" className={btnMain} onClick={stopVoice}>{t("ctx.add.voice.stop")}</button>
                ) : (
                  <button type="button" className={btnMain} disabled={reading} onClick={() => void startVoice()}>{reading ? t("ctx.add.reading") : t("ctx.add.voice.start")}</button>
                )}
              </div>
              <p className={fieldHelp}>{t("ctx.add.voice.hint")}</p>
            </div>
          ) : null}
          {addProblem ? <p className={alertBox} role="alert">{addProblem === "nomic" ? t("ctx.add.voice.nomic") : addProblem === "changed" ? t("ctx.changed") : sentence(addProblem)}</p> : null}

          {preview ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-2 p-4" data-part="understood">
              <h4 className="text-base font-semibold text-ink">{t("ctx.pv.title")}</h4>
              {preview.warnings.map((w) => (
                <p key={w} className={warnBox}>
                  {t(`ctx.warn.${w}` as "ctx.warn.cells_cut")}
                  {w === "looks_like_personal_data" ? <> <a className="font-semibold underline" href={sourcesHref}>{t("ctx.warn.link")}</a></> : null}
                </p>
              ))}
              {edited.trim() === "" ? (
                <p className="text-sm text-muted">{t("ctx.pv.empty")}</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2" aria-label={t("ctx.pv.title")}>
                    {[...new Set(preview.understood.map((u) => u.section))].map((s) => (
                      <li key={s} className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted">{t(`ctx.sec.${s}` as "ctx.sec.prices")}</li>
                    ))}
                  </ul>
                  <p className={fieldHelp}>{t("ctx.pv.edit")}</p>
                  <textarea aria-label={t("ctx.pv.title")} value={edited} onChange={(e) => setEdited(e.target.value)} rows={8} maxLength={NOTES_MAX} className={fieldTextarea} />
                  {notes.trim() !== "" ? (
                    <fieldset className="flex flex-wrap gap-4 text-sm">
                      {(["append", "replace"] as const).map((m) => (
                        <label key={m} className="inline-flex min-h-11 items-center gap-2">
                          <input type="radio" name="ctx-mode" checked={mode === m} onChange={() => setMode(m)} />
                          {t(`ctx.pv.${m}` as "ctx.pv.append")}
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {edited.trim() !== "" ? <button type="button" className={btnMain} onClick={() => void savePreview()}>{t("ctx.pv.save")}</button> : null}
                <button type="button" className={btnQuiet} onClick={() => { setPreview(null); setAddProblem(null); }}>{t("ctx.pv.discard")}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-col gap-2 border-t border-edge pt-4" data-part="try-it">
          <h3 className="text-base font-semibold text-ink">{t("ctx.test")}</h3>
          <p className={fieldHelp}>{t("ctx.test.hint")}</p>
          <div className="flex flex-wrap gap-2">
            <input value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} aria-label={t("ctx.test")} placeholder={t("ctx.test.ph")} className={`${fieldTextarea} min-h-11 flex-1`} />
            <button type="button" className={btnMain} disabled={asking || !question.trim()} onClick={() => void ask()}>{asking ? t("ctx.test.working") : t("ctx.test.ask")}</button>
          </div>
          {answer && !answer.ok ? <p className={alertBox} role="alert">{sentence(answer.error)}</p> : null}
          {answer?.ok ? (
            <div className={`${answer.data.wouldHandOver ? warnBox : okBox} flex flex-col gap-2`} aria-live="polite">
              {answer.data.wouldHandOver ? (
                <>
                  <p className="font-semibold">{t("ctx.test.hand")}</p>
                  {answer.data.reason ? <p>{t(`ctx.test.reason.${answer.data.reason}` as "ctx.test.reason.unsure")}</p> : null}
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">{t("ctx.test.answer")}</p>
                  <p className="whitespace-pre-wrap">{answer.data.answer}</p>
                </>
              )}
              {answer.data.used.map((u, i) => (
                <p key={i} className="text-sm"><span className="font-semibold">{t(u.from === "facts" ? "ctx.test.from.facts" : "ctx.test.from.notes")}:</span> {u.snippet}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="border-t border-edge pt-4" onToggle={(e) => e.currentTarget.open && void loadVersions()}>
        <summary className="min-h-11 cursor-pointer text-base font-semibold text-ink">{t("ctx.ver")}</summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className={fieldHelp}>{t("ctx.ver.note")}</p>
          {versions && !versions.ok ? <p className={alertBox}>{sentence(versions.error)}</p> : null}
          {versions?.ok && versions.data.length === 0 ? <p className="text-sm text-muted">{t("ctx.ver.none")}</p> : null}
          {versions?.ok ? (
            <ul className="flex flex-col divide-y divide-edge">
              {versions.data.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{t("ctx.ver.item", { v: v.version, when: when(v.updatedAt) })}{v.updatedBy ? ` · ${t("ctx.ver.by", { name: v.updatedBy })}` : ""}{v.change ? ` · ${v.change}` : ""}</span>
                  {canEdit && v.version !== meta.version ? <button type="button" className={btnQuiet} onClick={() => void restore(v.version)}>{t("ctx.ver.restore")}</button> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    </section>
  );
}
