"use client";

import * as React from "react";

import { btnQuiet, fieldLabel, fieldMono } from "../ui";
import { makeT, type Words } from "../words";

/** Copy to the clipboard: the modern way, then the old way (a hidden selection) for a browser that refuses. True when it worked. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** A read-only box with a Copy button (an address, an e-mail address, a form snippet). The value is only ever in the props and the box: nothing is stored or logged here. */
export function CopyBox({ words, id, label, value, multiline = false }: { words: Words; id: string; label: string; value: string; multiline?: boolean }) {
  const t = makeT(words);
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => setState((await copyToClipboard(value)) ? "copied" : "failed");
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-60">
          {multiline ? <textarea id={id} readOnly rows={Math.min(10, value.split("\n").length + 1)} value={value} className={fieldMono} onFocus={(e) => e.currentTarget.select()} /> : <input id={id} readOnly value={value} className={fieldMono} onFocus={(e) => e.currentTarget.select()} />}
        </div>
        <button type="button" className={btnQuiet} onClick={() => void copy()}>
          {state === "copied" ? t("lsrc.copied") : t("lsrc.copy")}
        </button>
      </div>
      {state === "failed" ? (
        <p role="alert" className="mt-1.5 text-sm text-red-text">
          {t("lsrc.copy.fail")}
        </p>
      ) : null}
    </div>
  );
}
