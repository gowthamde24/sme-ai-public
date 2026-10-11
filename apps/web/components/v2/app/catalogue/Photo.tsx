"use client";

import * as React from "react";

import { say, type TodayWords } from "../today/today-words";
import { usePhotoRefresh } from "./FreshPhotos";

/** The boxes a photo can have, as classes the stylesheet knows (the house rules forbid an inline style next to classes): the nearest of four proportions, thinnest to widest. */
const SHAPES = [
  { ratio: 0.75, cls: "aspect-[3/4]" },
  { ratio: 0.8, cls: "aspect-[4/5]" },
  { ratio: 1, cls: "aspect-square" },
  { ratio: 1.2, cls: "aspect-[6/5]" },
] as const;
export function shapeClass(shape: "card" | "natural" | "square", width: number, height: number): string {
  if (shape === "card") return "aspect-[4/5]";
  if (shape === "square") return "aspect-square";
  const r = width / height;
  return SHAPES.reduce((best, s) => (Math.abs(s.ratio - r) < Math.abs(best.ratio - r) ? s : best)).cls;
}

/**
 * One catalogue photo. The box has its shape BEFORE the picture arrives (a fixed 4:5 for the grid, the nearest of four proportions to the photo's own elsewhere), so nothing moves when it loads; the picture is lazy unless
 * it is the first thing on the screen. The link is a signed one that runs out: if the picture fails to load, the page is asked to read its data again (FreshPhotos), and the new link replaces the
 * old one. A picture that cannot be shown says so in words in the same box. Plain <img>: the link is signed and short-lived, so the framework's image resizer (which would fetch and cache it
 * by address) is of no use here; the API already makes the thumbnail (320 px) and the medium size (1280 px).
 */
export function Photo({ src, width, height, alt, words, shape = "card", eager = false, fit = "cover", className = "" }: { src: string | null; width: number; height: number; alt: string; words: TodayWords; shape?: "card" | "natural" | "square"; eager?: boolean; fit?: "cover" | "contain"; className?: string }) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const { request } = usePhotoRefresh();
  const failed = src === null || failedSrc === src;
  return (
    <div className={`relative w-full overflow-hidden bg-surface-2 ${shapeClass(shape, width, height)} ${className}`}>
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-sm text-muted">{say(words, src === null ? "catalogue.photo.none" : "catalogue.photo.error")}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link; see the comment above
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          {...(eager ? { fetchPriority: "high" as const } : {})}
          onError={() => {
            setFailedSrc(src);
            request();
          }}
          className={`absolute inset-0 size-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
        />
      )}
    </div>
  );
}
