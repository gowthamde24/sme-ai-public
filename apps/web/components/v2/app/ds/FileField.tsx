"use client";

import { Check, Upload, X } from "lucide-react";
import * as React from "react";

import { fieldHelp } from "../ui";
import { makeT, type Words } from "../words";

/**
 * Our own upload field (the browser's plain "Choose File" button does not belong in the product). ONE file. A dashed area: drop a file on it (desktop) or tap it (phone: at least 48 px high, one tap opens the file picker). The real `<input type="file">` is inside, visually hidden
 * but still THE control: it is focusable, the label (`htmlFor={id}`, drawn by the screen) is wired to it, Enter and Space open the picker, and the focus ring is drawn around the area. The file's kind and size are checked here BEFORE anything reads it; a wrong one is not kept
 * (`onFile(null, problem)`) and the sentence for it shows under the field (role="alert"). The sentences, `accept` and `maxBytes` come from the screen, so the field knows nothing about what the file is for. A chosen file shows a green tick, its name (cut in the middle, so a long name
 * never pushes past a 390 px phone), its size and a small x that removes it. The field only reports the file; the screen reads it when it needs to.
 */
export type FileProblem = "type" | "size" | "empty";

type Props = {
  id: string;
  words: Words;
  /** What the picker takes, as the `accept` attribute says it: ".pdf,image/png,image/*" (endings, kinds, `kind/*`). */
  accept: string;
  /** The most bytes one file may have. */
  maxBytes: number;
  /** The sentences under the field for a wrong kind and a too big file (and for an empty one; the kind sentence when not given). */
  typeError: string;
  sizeError: string;
  emptyError?: string;
  /** A sentence the screen wants shown (for example "Choose your document." when it was left empty, or the server refused the file); it wins over the field's own. */
  error?: string;
  /** One short help line under the field. */
  help?: string;
  /** For a screen with its own idea of an accepted file (the `accept` check stays when this is not given). */
  isAccepted?: (file: File) => boolean;
  onFile: (file: File | null, problem?: FileProblem) => void;
  disabled?: boolean;
};

/** "1.2 MB": decimal units, the way the size limits are written for people (5 MB = 5,000,000 bytes). */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A name cut in the MIDDLE: the start gives way (CSS truncates it), the last characters (the ending, so the kind of file still shows) always stay. */
export function splitName(name: string): { head: string; tail: string } {
  return name.length <= 24 ? { head: name, tail: "" } : { head: name.slice(0, -12), tail: name.slice(-12) };
}

function matches(file: File, accept: string): boolean {
  const kind = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? kind.startsWith(a.slice(0, -1)) : kind === a));
}

export function FileField({ id, words, accept, maxBytes, typeError, sizeError, emptyError, error, help, isAccepted, onFile, disabled = false }: Props) {
  const t = makeT(words);
  const input = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [problem, setProblem] = React.useState<FileProblem | null>(null);
  const [over, setOver] = React.useState(false);
  const [said, setSaid] = React.useState("");

  function take(f: File | null | undefined) {
    if (disabled) return;
    if (input.current) input.current.value = ""; // the same file can be chosen again after a removal
    if (!f) {
      setFile(null);
      setProblem(null);
      setSaid("");
      return onFile(null);
    }
    // checked here before a single byte is read
    const bad: FileProblem | null = !(isAccepted ? isAccepted(f) : matches(f, accept)) ? "type" : f.size === 0 ? "empty" : f.size > maxBytes ? "size" : null;
    setProblem(bad);
    setFile(bad ? null : f);
    setSaid(bad ? "" : t("ds.file.chosen", { name: f.name, size: fileSize(f.size) }));
    onFile(bad ? null : f, bad ?? undefined);
  }
  const remove = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    take(null);
    setSaid(t("ds.file.removed"));
  };

  const own = problem === "type" ? typeError : problem === "size" ? sizeError : problem === "empty" ? (emptyError ?? typeError) : "";
  const bad = error || own;
  const { head, tail } = file ? splitName(file.name) : { head: "", tail: "" };
  const zone = [
    "relative flex w-full cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 text-base text-ink",
    file ? "min-h-16" : "min-h-14 md:min-h-28 md:justify-center",
    "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
    bad ? "border-dashed border-red-text bg-red-bg" : over ? "border-dashed border-brand-edge bg-brand-bg" : file ? "border-solid border-edge bg-surface" : "border-dashed border-edge bg-surface hover:bg-surface-2",
    disabled ? "cursor-not-allowed opacity-60 hover:bg-surface" : "",
  ].join(" ");

  return (
    <div data-part="file-field" data-state={bad ? "error" : file ? "chosen" : "empty"}>
      <label
        htmlFor={id}
        className={zone}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer?.files?.[0]);
        }}
      >
        <input
          ref={input}
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => take(e.target.files?.[0])}
          aria-invalid={bad ? true : undefined}
          aria-describedby={[help ? `${id}-help` : "", bad ? `${id}-bad` : ""].filter(Boolean).join(" ") || undefined}
          className="sr-only"
        />
        {file ? (
          <>
            {bad ? null : (
              <span data-part="file-tick" aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-green-text text-bg">
                <Check className="size-4" strokeWidth={3} />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="flex min-w-0 font-semibold" title={file.name} data-part="file-name">
                <span className="truncate">{head}</span>
                {tail ? <span className="shrink-0">{tail}</span> : null}
              </span>
              <span className="text-sm text-muted">
                <span data-part="file-size">{fileSize(file.size)}</span> · {t("ds.file.change")}
              </span>
            </span>
            <button type="button" onClick={remove} disabled={disabled} aria-label={t("ds.file.remove")} className="-mr-1 grid size-11 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-60">
              <X className="size-5" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-bg text-brand-text">
              <Upload className="size-5" />
            </span>
            <span className="min-w-0 font-semibold md:text-center">{t("ds.file.drop")}</span>
          </>
        )}
      </label>
      <span role="status" className="sr-only">
        {said}
      </span>
      {help ? (
        <p id={`${id}-help`} className={fieldHelp}>
          {help}
        </p>
      ) : null}
      {bad ? (
        <p id={`${id}-bad`} role="alert" className="mt-1.5 text-sm font-medium text-red-text">
          {bad}
        </p>
      ) : null}
    </div>
  );
}
