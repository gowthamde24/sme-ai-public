"use client";

import { Contact, File as FileIcon, FileImage, FileSpreadsheet, FileText, FileType, Paperclip, RotateCcw, X, type LucideIcon } from "lucide-react";
import * as React from "react";

import { fixtureTransport, routeTransport, type WorkTransport } from "@/lib/assistant-work/client";
import { checkFile, FILE_ACCEPT, fileKindOf, MAX_FILE_MB, MAX_FILES, NOT_YET_KINDS, notYetFileJson, sizeLabel, type FileKind, type FileRefusal } from "@/lib/assistant-work/files";

import type { AskEvent, LocalAnswer } from "../ask-types";

import { makeT, type Words } from "../../../words";
import type { WorkEnv, WorkRole } from "./work-env";
import { createWorkStore } from "./work-store";

/**
 * Whether the chat does the work (ASSISTANT_WORK_SCREENS), handed down by the workspace layout: `on` = the route and the API (C1's contract, docs/contracts/assistant-tools.md), `mock` = made-up answers in
 * the browser (a file is "uploaded" nowhere: it never leaves the page, and no id is sent with the message). Absent = the chat as before (no "Add a file", no cards).
 */
export type WorkOptions = { mode: "on" | "mock"; role: WorkRole };

/** The upload's progress bar in tenths (literal classes, so Tailwind makes them; no inline style). */
const BAR = ["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-1/2", "w-[60%]", "w-[70%]", "w-[80%]", "w-[90%]", "w-full"] as const;

/** `kind`: what the name (or, without an extension, the browser's type) says; once uploaded, the API's kind (it reads the first bytes) replaces it. */
type Chip = { key: string; file: File; kind: FileKind | null; status: "uploading" | "ready" | "failed"; progress: number; fileId: string | null; error: string | null };

/** Each kind's picture on its chip (the words say the kind too: the picture is never the only sign). */
const ICON_OF: Readonly<Record<FileKind, LucideIcon>> = { sheet: FileSpreadsheet, pdf: FileText, image: FileImage, doc: FileType, contacts: Contact, text: FileIcon };

const ERROR_OF: Readonly<Record<FileRefusal | "forbidden" | "down" | "aborted", string>> = {
  type: "bv.work.file.err.type",
  size: "bv.work.file.err.size",
  empty: "bv.work.file.err.empty",
  count: "bv.work.file.err.count",
  forbidden: "bv.work.file.err.forbidden",
  down: "bv.work.file.failed",
  aborted: "bv.work.file.failed",
};

/**
 * The chat's work: files beside a message ("+" > "Add a file", drag-and-drop onto the composer, the phone's file picker), each a chip with its name, size, a remove button and its upload state;
 * and the environment the work cards of the answers need. ONE hook call in ChatPanel; every piece it returns is a slot that draws nothing when the feature is off.
 */
export function useChatWork(options: WorkOptions | null | undefined, base: string, words: Words, onChange: (text: string) => void, given?: WorkTransport) {
  const on = !!options;
  const t = React.useMemo(() => makeT(words), [words]);
  const transport = React.useMemo<WorkTransport>(() => given ?? (options?.mode === "on" ? routeTransport(base) : fixtureTransport()), [given, options?.mode, base]);
  const [store] = React.useState(createWorkStore);
  const changeRef = React.useRef(onChange);
  React.useEffect(() => {
    changeRef.current = onChange;
  });
  const env = React.useMemo<WorkEnv | null>(() => (options ? { t, role: options.role, transport, store, onChange: (text) => changeRef.current(text) } : null), [options, t, transport, store]);

  const [chips, setChips] = React.useState<Chip[]>([]);
  const [refused, setRefused] = React.useState<string[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const picker = React.useRef<HTMLInputElement>(null);
  const aborts = React.useRef(new Map<string, AbortController>());
  const seq = React.useRef(0);

  const upload = React.useCallback(
    (key: string, file: File) => {
      const controller = new AbortController();
      aborts.current.set(key, controller);
      setChips((list) => list.map((c) => (c.key === key ? { ...c, status: "uploading", progress: 0, error: null } : c)));
      void transport
        .upload(file, (f) => setChips((list) => list.map((c) => (c.key === key ? { ...c, progress: f } : c))), controller.signal)
        .then((out) => {
          aborts.current.delete(key);
          if (!out.ok && out.error === "aborted") return;
          setChips((list) => list.map((c) => (c.key !== key ? c : out.ok ? { ...c, status: "ready", progress: 1, fileId: out.file.fileId, kind: out.file.kind } : { ...c, status: "failed", error: ERROR_OF[out.error] })));
        });
    },
    [transport],
  );

  const add = React.useCallback(
    (files: FileList | readonly File[] | null) => {
      if (!files || !on) return;
      const problems: string[] = [];
      let waiting = chips.length;
      const fresh: Chip[] = [];
      for (const file of Array.from(files)) {
        const why = checkFile(file, waiting); // checked BEFORE anything is uploaded
        if (why) {
          problems.push(t(ERROR_OF[why], { name: file.name.slice(0, 80), n: MAX_FILES, mb: MAX_FILE_MB }));
          continue;
        }
        waiting++;
        fresh.push({ key: `f${++seq.current}`, file, kind: fileKindOf(file.name, file.type), status: "uploading", progress: 0, fileId: null, error: null });
      }
      setRefused(problems);
      if (fresh.length === 0) return;
      setChips((list) => [...list, ...fresh]);
      for (const c of fresh) upload(c.key, c.file);
    },
    [chips.length, on, t, upload],
  );

  const remove = (key: string) => {
    aborts.current.get(key)?.abort();
    aborts.current.delete(key);
    setChips((list) => list.filter((c) => c.key !== key));
  };

  const ready = chips.filter((c) => c.status === "ready");
  const uploading = chips.some((c) => c.status === "uploading");

  const cardSeq = React.useRef(0);
  /**
   * The message to send with its files, and the chips are cleared. `text`: the typed words, or the files' names when none were typed (the contract: `text` is still required). `ids`: only a real
   * upload's id is sent; in mock mode the file never left the page and nothing is sent. `local` (mock mode only): a PDF, a photo or a Word file gets the contract's honest "can't do yet" card,
   * made here; when the message is ONLY such files, the whole answer is made here (nothing reaches the network) and says so in words.
   */
  const take = (typed: string): { text: string; ids: string[]; local: LocalAnswer | null } => {
    const text = typed.trim() !== "" || ready.length === 0 ? typed : ready.map((c) => `📎 ${c.file.name}`).join("\n");
    const ids = options?.mode === "on" ? ready.map((c) => c.fileId).filter((x): x is string => x !== null) : [];
    const notYet = options?.mode === "mock" ? ready.filter((c) => c.kind !== null && NOT_YET_KINDS.includes(c.kind)) : [];
    let local: LocalAnswer | null = null;
    if (notYet.length > 0) {
      const cards: AskEvent[] = notYet.map((c) => ({ type: "work_card", card: notYetFileJson(++cardSeq.current, t("bv.work.cant.file", { name: c.file.name.slice(0, 120), kind: t(`bv.work.file.kind.${c.kind}`) }), t("bv.work.cant.file.screen")) }));
      const alone = typed.trim() === "" && notYet.length === ready.length;
      local = { alone, events: alone ? [{ type: "text", delta: t("bv.work.cant.file.say") }, ...cards] : cards };
    }
    if (ready.length > 0) setChips((list) => list.filter((c) => c.status !== "ready"));
    setRefused([]);
    return { text, ids, local };
  };

  const uid = React.useId();
  // the menu item is named "Add a file"; the kinds it takes are its description (said after the name, never part of it)
  const menuItem = (close: () => void) =>
    on ? (
      <button type="button" role="menuitem" data-chat="add-file" aria-labelledby={`${uid}-add`} aria-describedby={`${uid}-types`} onClick={() => { close(); picker.current?.click(); }} className="flex min-h-10 items-start gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-semibold hover:bg-surface-2">
        <Paperclip className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span id={`${uid}-add`}>{t("bv.work.file.add")}</span>
          <span id={`${uid}-types`} data-chat="file-types" className="text-xs font-normal text-muted">
            {t("bv.work.file.types", { mb: MAX_FILE_MB })}
          </span>
        </span>
      </button>
    ) : null;

  const input = on ? <input ref={picker} type="file" multiple accept={FILE_ACCEPT} data-chat="file-input" className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => { add(e.currentTarget.files); e.currentTarget.value = ""; }} /> : null;

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dropProps = on
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: React.DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        },
        "data-dragging": dragging ? "true" : undefined,
      }
    : {};

  const chipsEl =
    on && (chips.length > 0 || refused.length > 0 || dragging) ? (
      <div data-chat="files" className="flex flex-col gap-1.5">
        {dragging ? (
          <p data-chat="drop-here" className="rounded-lg border border-dashed border-brand-edge bg-brand-bg px-3 py-2 text-center text-sm font-semibold text-brand-text">
            {t("bv.work.file.drop")}
          </p>
        ) : null}
        {chips.length > 0 ? (
          <ul aria-label={t("bv.work.file.label")} className="flex flex-wrap gap-1.5">
            {chips.map((c) => {
              const Icon = c.kind ? ICON_OF[c.kind] : FileIcon;
              return (
              <li key={c.key} data-chat="file-chip" data-status={c.status} data-kind={c.kind ?? undefined} className="flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-xl border border-line bg-surface-2 py-1 pl-2.5 pr-1">
                <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{c.file.name}</span>
                  <span className={`text-xs ${c.status === "failed" ? "text-red-text" : "text-muted"}`} role={c.status === "failed" ? "alert" : undefined}>
                    {c.kind ? `${t(`bv.work.file.kind.${c.kind}`)} · ` : null}
                    {sizeLabel(c.file.size)}
                    {" · "}
                    {c.status === "uploading" ? t("bv.work.file.uploading", { percent: Math.round(c.progress * 100) }) : c.status === "ready" ? (options?.mode === "mock" ? t("bv.work.file.local") : t("bv.work.file.ready")) : t(c.error ?? ERROR_OF.down, { name: c.file.name.slice(0, 80), mb: MAX_FILE_MB })}
                  </span>
                  {c.status === "uploading" ? (
                    <span aria-hidden="true" className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-line">
                      <span className={`block h-full rounded-full bg-brand ${BAR[Math.round(c.progress * 10)] ?? "w-full"}`} />
                    </span>
                  ) : null}
                </span>
                {c.status === "failed" ? (
                  <button type="button" data-chat="file-retry" onClick={() => upload(c.key, c.file)} aria-label={t("bv.work.file.retry")} title={t("bv.work.file.retry")} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface">
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
                <button type="button" data-chat="file-remove" onClick={() => remove(c.key)} aria-label={t("bv.work.file.remove", { name: c.file.name.slice(0, 80) })} title={t("bv.work.file.remove", { name: c.file.name.slice(0, 80) })} className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-surface">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
              );
            })}
          </ul>
        ) : null}
        {refused.map((r, i) => (
          <p key={i} role="alert" data-chat="file-refused" className="text-sm font-medium text-red-text [overflow-wrap:anywhere]">
            {r}
          </p>
        ))}
      </div>
    ) : null;

  return { on, env, menuItem, input, dropProps, chips: chipsEl, hasReady: ready.length > 0, uploading, take, add };
}
