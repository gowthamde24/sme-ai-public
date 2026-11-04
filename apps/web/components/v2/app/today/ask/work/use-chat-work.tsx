"use client";

import { File as FileIcon, Paperclip, RotateCcw, X } from "lucide-react";
import * as React from "react";

import { fixtureTransport, routeTransport, type WorkTransport } from "@/lib/assistant-work/client";
import { checkFile, FILE_ACCEPT, MAX_FILES, sizeLabel, type FileRefusal } from "@/lib/assistant-work/types";

import { makeT, type Words } from "../../../words";
import type { WorkEnv, WorkRole } from "./work-env";
import { createWorkStore } from "./work-store";

/**
 * Whether the chat does the work (ASSISTANT_WORK_SCREENS), handed down by the workspace layout: `on` = the route and the API (ASSUMED until docs/contracts/assistant-tools.md), `mock` = made-up answers in
 * the browser (a file is "uploaded" nowhere: it never leaves the page, and no id is sent with the message). Absent = the chat as before (no "Add a file", no cards).
 */
export type WorkOptions = { mode: "on" | "mock"; role: WorkRole };

/** The upload's progress bar in tenths (literal classes, so Tailwind makes them; no inline style). */
const BAR = ["w-0", "w-[10%]", "w-[20%]", "w-[30%]", "w-[40%]", "w-1/2", "w-[60%]", "w-[70%]", "w-[80%]", "w-[90%]", "w-full"] as const;

type Chip = { key: string; file: File; status: "uploading" | "ready" | "failed"; progress: number; fileId: string | null; error: string | null };

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
          setChips((list) => list.map((c) => (c.key !== key ? c : out.ok ? { ...c, status: "ready", progress: 1, fileId: out.file.fileId } : { ...c, status: "failed", error: ERROR_OF[out.error] })));
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
          problems.push(t(ERROR_OF[why], { name: file.name.slice(0, 80), n: MAX_FILES }));
          continue;
        }
        waiting++;
        fresh.push({ key: `f${++seq.current}`, file, status: "uploading", progress: 0, fileId: null, error: null });
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

  /** What the message says when only files are sent: their names (the assistant decides what they are). */
  const textFor = (typed: string): string => (typed.trim() !== "" || ready.length === 0 ? typed : ready.map((c) => `📎 ${c.file.name}`).join("\n"));
  /** The files that go with the message, and the chips are cleared. Only a real upload's id is sent; in mock mode the file never left the page and nothing is sent. */
  const take = (): string[] => {
    const ids = options?.mode === "on" ? ready.map((c) => c.fileId).filter((x): x is string => x !== null) : [];
    if (ready.length > 0) setChips((list) => list.filter((c) => c.status !== "ready"));
    setRefused([]);
    return ids;
  };

  const menuItem = (close: () => void) =>
    on ? (
      <button type="button" role="menuitem" data-chat="add-file" onClick={() => { close(); picker.current?.click(); }} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold hover:bg-surface-2">
        <Paperclip className="size-4" aria-hidden="true" />
        {t("bv.work.file.add")}
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
            {chips.map((c) => (
              <li key={c.key} data-chat="file-chip" data-status={c.status} className="flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-xl border border-line bg-surface-2 py-1 pl-2.5 pr-1">
                <FileIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{c.file.name}</span>
                  <span className={`text-xs ${c.status === "failed" ? "text-red-text" : "text-muted"}`} role={c.status === "failed" ? "alert" : undefined}>
                    {sizeLabel(c.file.size)}
                    {" · "}
                    {c.status === "uploading" ? t("bv.work.file.uploading", { percent: Math.round(c.progress * 100) }) : c.status === "ready" ? (options?.mode === "mock" ? t("bv.work.file.local") : t("bv.work.file.ready")) : t(c.error ?? ERROR_OF.down, { name: c.file.name.slice(0, 80) })}
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
            ))}
          </ul>
        ) : null}
        {refused.map((r, i) => (
          <p key={i} role="alert" data-chat="file-refused" className="text-sm font-medium text-red-text [overflow-wrap:anywhere]">
            {r}
          </p>
        ))}
      </div>
    ) : null;

  return { on, env, menuItem, input, dropProps, chips: chipsEl, hasReady: ready.length > 0, uploading, textFor, take, add };
}
