"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { KINDS, LANGS, MAX_BYTES, type MarksBatch, type MarksKind, type MarksLang, type MarksPreview, type MarksSent } from "@/lib/marks/types";

import { postFile } from "../cc/post";
import { alertBox, btnMain, btnQuiet, fieldInput, fieldLabel, fieldHelp, mutedText, noteBox, okBox, pageH1, pageH2, surface, warnBox } from "../ui";
import { makeT, type Words } from "../words";

type Failed = { code?: string; mfa?: boolean; error?: string };
const ERR: Record<string, string> = {
  marks_file_changed: "marks.err.changed",
  marks_count_changed: "marks.err.changed",
  marks_file_too_large: "marks.err.big",
  file_too_large: "marks.err.big",
  marks_file_too_many_rows: "marks.err.rows",
  marks_file_missing_column: "marks.err.column",
  module_off: "marks.err.module",
  workspace_read_only: "marks.err.readonly",
};
const FORMAT = ["marks_file_empty", "marks_file_not_utf8", "marks_file_malformed_csv", "marks_file_not_xlsx", "marks_bad_request", "invalid_id"];
const LANG_NAME: Record<MarksLang, string> = { en: "English", te: "తెలుగు", hi: "हिन्दी", kn: "ಕನ್ನಡ" };
const when = (iso: string | null): string => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "");

/**
 * "Send marks to parents" (job DP; a school; C1's contract-marks-messages.md). OWNER DECISION: marks are never stored. The file is chosen here and kept in this page's memory only; it goes to the server TWICE, once for the
 * preview (counts, problems, the first message as the parent will read it) and once, with the preview's SHA-256 and count, when the Owner approves, so only the file that was checked can be sent. Closing the page is the
 * cancel. Afterwards only a log stays (who was sent which message, and when). The page says so, plainly, before anything is chosen. `canSend`: only the Owner approves (an Admin may check a file).
 */
export function MarksSend({ base, words, canSend, mock, log }: { base: string; words: Words; canSend: boolean; mock: boolean; log: readonly MarksBatch[] | null }) {
  const t = makeT(words);
  const router = useRouter();
  const [kind, setKind] = React.useState<MarksKind>("marks");
  const [language, setLanguage] = React.useState<MarksLang>("te");
  const [term, setTerm] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [phase, setPhase] = React.useState<"pick" | "previewing" | "preview" | "sending" | "done">("pick");
  const [preview, setPreview] = React.useState<MarksPreview | null>(null);
  const [sent, setSent] = React.useState<MarksSent | null>(null);
  const [failed, setFailed] = React.useState<Failed | null>(null);
  const [batchId, setBatchId] = React.useState(() => crypto.randomUUID()); // one per send: a retry with it never sends a line twice

  const query = (extra: Record<string, string> = {}): string => new URLSearchParams({ kind, language, ...(term.trim() ? { term: term.trim() } : {}), ...extra }).toString();
  async function call<T>(step: "preview" | "send", extra: Record<string, string>): Promise<{ ok: true; data: T } | { ok: false; why: Failed }> {
    if (!file) return { ok: false, why: {} };
    const reply = await postFile<T>(`${base}/marks/${step}?${query(extra)}`, file);
    if (reply.ok && reply.data) return { ok: true, data: reply.data };
    return reply.ok ? { ok: false, why: {} } : { ok: false, why: { code: reply.code, mfa: reply.mfa, error: reply.error } };
  }
  const reasonOf = (w: Failed): string => (w.mfa ? t("today.err.mfa") : w.code && ERR[w.code] ? t(ERR[w.code] as "marks.err.big") : w.code && FORMAT.includes(w.code) ? t("marks.err.format") : t("marks.err.generic"));

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!file || phase === "previewing") return;
    setFailed(null);
    if (file.size > MAX_BYTES) return setFailed({ code: "marks_file_too_large" });
    setPhase("previewing");
    const out = await call<MarksPreview>("preview", {});
    if (out.ok) {
      setPreview(out.data);
      setPhase("preview");
    } else {
      setFailed(out.why);
      setPhase("pick");
    }
  }
  async function approve() {
    if (!preview || phase === "sending") return;
    setFailed(null);
    setPhase("sending");
    const out = await call<MarksSent>("send", { batch_id: batchId, expect_sha256: preview.fileSha256, expect_count: String(preview.willSend) });
    if (out.ok) {
      setSent(out.data);
      setFile(null); // the file leaves this page's memory with the send
      setPhase("done");
      router.refresh();
    } else {
      setFailed(out.why);
      setPhase("preview");
    }
  }
  function again() {
    setFile(null);
    setPreview(null);
    setSent(null);
    setFailed(null);
    setBatchId(crypto.randomUUID());
    setPhase("pick");
  }

  const busy = phase === "previewing" || phase === "sending";
  return (
    <div data-screen="marks" className="flex flex-col gap-5">
      <header>
        <h1 className={pageH1}>{t("marks.title")}</h1>
        <p className={mutedText}>{t("marks.sub")}</p>
      </header>
      {mock ? (
        <p role="note" className={warnBox}>
          {t("marks.mock")}
        </p>
      ) : null}
      <section className={noteBox} aria-label={t("marks.note")}>
        <p className="font-semibold" data-part="marks-note">
          {t("marks.note")}
        </p>
        <p className="mt-1 font-normal">{t("marks.note.more")}</p>
      </section>

      {phase === "done" && sent ? (
        <section role="status" className={`${okBox} flex flex-col gap-1`} data-part="marks-done">
          <h2 className="font-semibold">{t("marks.done.title")}</h2>
          <p>{t("marks.done", { sent: sent.sent, failed: sent.failed, blocked: sent.blocked, skipped: sent.skipped })}</p>
          {sent.alreadyHandled > 0 ? <p>{t("marks.done.dup", { n: sent.alreadyHandled })}</p> : null}
          <p>{t("marks.done.file")}</p>
          <div className="mt-2">
            <button type="button" className={btnQuiet} onClick={again}>
              {t("marks.again")}
            </button>
          </div>
        </section>
      ) : (
        <form onSubmit={check} className={`${surface} flex flex-col gap-4`} aria-busy={busy}>
          <fieldset disabled={busy || phase === "preview"} className="flex flex-col gap-4">
            <div>
              <label htmlFor="mk-kind" className={fieldLabel}>
                {t("marks.kind")}
              </label>
              <select id="mk-kind" value={kind} onChange={(e) => setKind(e.target.value as MarksKind)} className={fieldInput}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`marks.kind.${k}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mk-lang" className={fieldLabel}>
                {t("marks.language")}
              </label>
              <select id="mk-lang" value={language} onChange={(e) => setLanguage(e.target.value as MarksLang)} className={fieldInput}>
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAME[l]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mk-term" className={fieldLabel}>
                {t("marks.term")}
              </label>
              <input id="mk-term" value={term} maxLength={40} onChange={(e) => setTerm(e.target.value)} className={fieldInput} />
            </div>
            <div>
              <label htmlFor="mk-file" className={fieldLabel}>
                {t("marks.file")}
              </label>
              <input id="mk-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPreview(null), setFailed(null))} className="block min-h-12 w-full text-base" />
              <p className={fieldHelp}>{t(`marks.cols.${kind}`)}</p>
            </div>
          </fieldset>
          {failed && phase !== "preview" ? (
            <p role="alert" className={alertBox}>
              {reasonOf(failed)}{" "}
              {failed.mfa ? (
                <Link href="/app/security" className="font-semibold underline">
                  {t("today.err.mfa.link")}
                </Link>
              ) : null}
            </p>
          ) : null}
          {phase === "preview" ? (
            <div>
              <button type="button" className={btnQuiet} onClick={again}>
                {t("marks.again")}
              </button>
            </div>
          ) : (
            <div>
              <button type="submit" className={btnMain} disabled={!file || busy}>
                {phase === "previewing" ? t("marks.previewing") : t("marks.preview")}
              </button>
            </div>
          )}
        </form>
      )}

      {phase === "preview" || phase === "sending" ? (
        preview && (
          <section className={`${surface} flex flex-col gap-3`} aria-labelledby="mk-pv-h" data-part="marks-preview">
            <h2 id="mk-pv-h" className={pageH2 + " !mt-0"}>
              {t("marks.pv.title")}
            </h2>
            <p>{t("marks.pv.rows", { n: preview.rows })}</p>
            <p className="font-semibold" data-part="will-send">
              {t("marks.pv.send", { n: preview.willSend })}
            </p>
            {preview.blocked > 0 ? <p>{t("marks.pv.blocked", { n: preview.blocked })}</p> : null}
            {preview.unknownGuardian > 0 ? <p>{t("marks.pv.unknown", { n: preview.unknownGuardian })}</p> : null}
            {preview.invalid > 0 ? <p>{t("marks.pv.invalid", { n: preview.invalid })}</p> : null}
            {preview.duplicates > 0 ? <p>{t("marks.pv.dups", { n: preview.duplicates })}</p> : null}
            {preview.issues.length > 0 ? (
              <div>
                <h3 className="font-semibold">{t("marks.pv.issues")}</h3>
                <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
                  {preview.issues.map((i, n) => (
                    <li key={n}>{i.field ? t("marks.pv.issue", { line: i.line, what: t(`marks.issue.${i.code}`), field: i.field }) : t("marks.pv.issue.line", { line: i.line, what: t(`marks.issue.${i.code}`) })}</li>
                  ))}
                </ul>
                {preview.issuesTruncated ? <p className={mutedText}>{t("marks.pv.moreissues")}</p> : null}
              </div>
            ) : null}
            {preview.exampleText ? (
              <div>
                <h3 className="font-semibold">{t("marks.pv.example")}</h3>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 [overflow-wrap:anywhere]" lang={language}>
                  {preview.exampleText}
                </p>
              </div>
            ) : null}
            {failed ? (
              <p role="alert" className={alertBox}>
                {reasonOf(failed)}{" "}
                {failed.mfa ? (
                  <Link href="/app/security" className="font-semibold underline">
                    {t("today.err.mfa.link")}
                  </Link>
                ) : null}
              </p>
            ) : null}
            {preview.willSend === 0 ? <p className={mutedText}>{t("marks.go.none")}</p> : null}
            {canSend ? (
              <div>
                <button type="button" className={btnMain} disabled={preview.willSend === 0 || phase === "sending"} onClick={() => void approve()}>
                  {phase === "sending" ? t("marks.sending") : t("marks.go", { n: preview.willSend })}
                </button>
              </div>
            ) : (
              <p className={mutedText}>{t("marks.go.owner")}</p>
            )}
          </section>
        )
      ) : null}

      <section className={surface} aria-labelledby="mk-log-h" data-part="marks-log">
        <h2 id="mk-log-h" className={pageH2 + " !mt-0"}>
          {t("marks.log.title")}
        </h2>
        {log === null ? (
          <p className={mutedText}>{t("frame.notyet")}</p>
        ) : log.length === 0 ? (
          <p className={mutedText}>{t("marks.log.none")}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-base">
            {log.map((b) => (
              <li key={b.batchId}>{t("marks.log.row", { when: when(b.at), sent: b.sent, failed: b.failed, blocked: b.blocked })}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
