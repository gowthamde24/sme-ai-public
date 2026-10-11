"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import type { Photo as PhotoData } from "@/lib/api/catalogue";

import { say, type TodayWords } from "../today/today-words";
import { Photo } from "./Photo";

/** The proportions every slide shares, from the first photo but never thinner than 3:4 or wider than 6:5, so the page does not jump from one photo to the next. */
export function slideRatio(first: { width: number; height: number }): { width: number; height: number } {
  const r = Math.min(1.2, Math.max(0.75, first.width / first.height));
  return { width: Math.round(r * 1000), height: 1000 };
}

/**
 * The big photos of a saree (job BC): swipe sideways on a phone (the browser's own scroll-snap, so it is smooth and needs no script), or use the arrow buttons, the dots-sized thumbnails under it, or the
 * left and right arrow keys. The slide that is showing is said in words ("Photo 2 of 3") for a screen reader. The first photo is loaded at once, the others when they come near; every slide has the same
 * box, so nothing moves while they load.
 */
export function Gallery({ photos, name, words }: { photos: readonly PhotoData[]; name: string; words: TodayWords }) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);
  if (photos.length === 0)
    return (
      <div data-gallery="none" className="flex aspect-[4/5] w-full max-w-xl items-center justify-center rounded-2xl border border-dashed border-edge bg-surface-2 p-4 text-center text-base text-muted">
        {say(words, "catalogue.gallery.none")}
      </div>
    );
  const ratio = slideRatio(photos[0]);
  const show = (i: number) => {
    const el = scroller.current;
    const target = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(target);
    if (el && typeof el.scrollTo === "function") el.scrollTo({ left: target * el.clientWidth, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return (
    <section aria-roledescription="carousel" aria-label={say(words, "catalogue.gallery.label", { name })} data-gallery="photos" className="flex w-full max-w-xl flex-col gap-2">
      <div className="relative">
        <div
          ref={scroller}
          tabIndex={0}
          data-part="slides"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              show(index + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              show(index - 1);
            }
          }}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl border border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {photos.map((ph, i) => (
            <div key={ph.id} role="group" aria-roledescription="slide" aria-label={say(words, "catalogue.gallery.count", { n: i + 1, total: photos.length })} className="w-full shrink-0 snap-center">
              <Photo src={ph.url ?? ph.thumb_url} width={ratio.width} height={ratio.height} alt={say(words, "catalogue.photo.alt", { name, n: i + 1 })} words={words} shape="natural" fit="contain" eager={i === 0} />
            </div>
          ))}
        </div>
        {photos.length > 1 ? (
          <>
            <button type="button" aria-label={say(words, "catalogue.gallery.prev")} disabled={index === 0} onClick={() => show(index - 1)} className="absolute left-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-ink shadow-[var(--v2-shadow)] disabled:opacity-40">
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button type="button" aria-label={say(words, "catalogue.gallery.next")} disabled={index === photos.length - 1} onClick={() => show(index + 1)} className="absolute right-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-edge bg-surface text-ink shadow-[var(--v2-shadow)] disabled:opacity-40">
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      <p aria-live="polite" className="text-sm text-muted">
        {say(words, "catalogue.gallery.count", { n: index + 1, total: photos.length })}
      </p>
      {photos.length > 1 ? (
        <ul className="flex flex-wrap gap-2" data-part="thumbs">
          {photos.map((ph, i) => (
            <li key={ph.id}>
              <button type="button" aria-label={say(words, "catalogue.gallery.go", { n: i + 1 })} aria-current={i === index ? "true" : undefined} onClick={() => show(i)} className={`block min-h-11 w-14 overflow-hidden rounded-lg border-2 ${i === index ? "border-brand-edge" : "border-transparent"}`}>
                <Photo src={ph.thumb_url} width={ph.width} height={ph.height} alt="" words={words} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
