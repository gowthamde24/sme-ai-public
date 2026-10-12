"use client";

import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { secondary } from "../visits/styles";
import { Photo } from "./Photo";

/**
 * The photos of one saree, in order (job BC). The first is the cover. Each can be moved three ways, so nobody is left out: dragged by its handle (a pointer, so a finger works as well as a mouse), moved
 * one place with the arrow buttons, or made the cover with one button; every move is also said aloud to a screen reader. A photo that is being uploaded shows how far it is; one that failed says why
 * and can be tried again. All buttons are 44 px or more. The tray only reports what the person did (`onMove`, `onRemove`, `onRetry`); the form owns the list.
 */
export type TraySlot = {
  key: string;
  /** The picture to show: the thumbnail link of a saved photo, or the local preview of a new one. */
  src: string | null;
  fresh: boolean;
  status: "saved" | "waiting" | "uploading" | "done" | "failed";
  percent: number;
  /** OUR sentence for why it failed. */
  error: string | null;
};

/** The index a vertical pointer position falls on, from the rows' boxes (top and bottom): above the first is 0, below the last is the last. Pure, so it can be tested without a layout engine. */
export function indexAt(rows: readonly { top: number; bottom: number }[], y: number): number {
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i++) if (y < (rows[i].top + rows[i].bottom) / 2) return i;
  return rows.length - 1;
}

export function PhotoTray({ slots, words, name, disabled, onMove, onRemove, onRetry }: { slots: readonly TraySlot[]; words: TodayWords; name: string; disabled: boolean; onMove: (from: number, to: number) => void; onRemove: (index: number) => void; onRetry: (index: number) => void }) {
  const rows = React.useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = React.useState<{ from: number; to: number } | null>(null);
  const [said, setSaid] = React.useState("");
  const move = (from: number, to: number) => {
    const target = Math.max(0, Math.min(slots.length - 1, to));
    if (target === from) return;
    onMove(from, target);
    setSaid(say(words, "catalogue.photo.moved", { n: target + 1, total: slots.length }));
  };
  const boxes = () => rows.current.slice(0, slots.length).map((el) => (el ? el.getBoundingClientRect() : { top: 0, bottom: 0 }));

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {said}
      </p>
      <ol className="flex flex-col gap-2" data-tray="photos">
        {slots.map((s, i) => {
          const n = i + 1;
          const dragging = drag?.from === i;
          const over = drag !== null && drag.to === i && drag.from !== i;
          return (
            <li
              key={s.key}
              ref={(el) => {
                rows.current[i] = el;
              }}
              data-slot={s.status}
              data-cover={i === 0 ? "true" : undefined}
              className={`flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-2 ${over ? "border-brand-edge bg-brand-bg" : "border-line"} ${dragging ? "opacity-60" : ""}`}
            >
              <button
                type="button"
                disabled={disabled}
                aria-label={say(words, "catalogue.photo.drag", { n })}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  setDrag({ from: i, to: i });
                }}
                onPointerMove={(e) => {
                  if (drag && drag.from === i) setDrag({ from: i, to: indexAt(boxes(), e.clientY) });
                }}
                onPointerUp={() => {
                  if (drag && drag.from === i) move(i, drag.to);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    move(i, i + 1);
                  }
                }}
                className="inline-flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-muted hover:bg-surface-2 active:cursor-grabbing disabled:opacity-60"
              >
                <GripVertical className="size-5" aria-hidden="true" />
              </button>
              <div className="w-16 shrink-0 overflow-hidden rounded-lg">
                <Photo src={s.src} width={4} height={5} alt={say(words, "catalogue.photo.alt", { name, n })} words={words} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {i === 0 ? <span className="rounded-full bg-brand-bg px-2.5 py-0.5 text-brand-text">{say(words, "catalogue.photo.cover")}</span> : null}
                  <span>{say(words, "catalogue.gallery.count", { n, total: slots.length })}</span>
                  {s.fresh ? <span className="text-muted">{say(words, "catalogue.photo.new")}</span> : null}
                </p>
                {s.status === "waiting" ? <p className="text-sm text-muted">{say(words, "catalogue.photo.waiting")}</p> : null}
                {s.status === "uploading" ? (
                  <div className="flex items-center gap-2">
                    <progress value={s.percent} max={100} aria-label={say(words, "catalogue.photo.uploading", { percent: s.percent })} className="h-2 w-full max-w-48 accent-brand-text" />
                    <span className="text-sm text-muted">{say(words, "catalogue.photo.uploading", { percent: s.percent })}</span>
                  </div>
                ) : null}
                {s.status === "done" ? <p className="text-sm text-green-text">{say(words, "catalogue.photo.done")}</p> : null}
                {s.status === "failed" ? (
                  <p role="alert" className="text-sm font-medium text-red-text">
                    {say(words, "catalogue.photo.failed", { why: s.error ?? "" })}
                  </p>
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
                {i > 0 ? (
                  <button type="button" disabled={disabled} onClick={() => move(i, 0)} className={`${secondary} !px-3 !text-sm`}>
                    {say(words, "catalogue.photo.setcover", { n })}
                  </button>
                ) : null}
                <button type="button" data-repeat="" disabled={disabled || i === 0} aria-label={say(words, "catalogue.photo.up", { n })} onClick={() => move(i, i - 1)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-40">
                  <ArrowUp className="size-5" aria-hidden="true" />
                </button>
                <button type="button" data-repeat="" disabled={disabled || i === slots.length - 1} aria-label={say(words, "catalogue.photo.down", { n })} onClick={() => move(i, i + 1)} className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-2 disabled:opacity-40">
                  <ArrowDown className="size-5" aria-hidden="true" />
                </button>
                {s.status === "failed" ? (
                  <button type="button" disabled={disabled} onClick={() => onRetry(i)} className={`${secondary} !px-3 !text-sm`}>
                    {say(words, "catalogue.photo.retry")}
                  </button>
                ) : null}
                <button type="button" disabled={disabled} aria-label={say(words, "catalogue.photo.remove", { n })} onClick={() => onRemove(i)} className="inline-flex size-11 items-center justify-center rounded-lg text-red-text hover:bg-red-bg disabled:opacity-40">
                  <Trash2 className="size-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
