"use client";

import { say, type TodayWords } from "../today/today-words";
import { Photo } from "./Photo";

/**
 * The photos a WhatsApp message carries (a catalogue send, job AY/BC), as small thumbnails in the order they go out. The links are signed and run out; a thumbnail that cannot be shown says so in words. These
 * are lazy and have their shape before they load. Used in the Outbox rows and on Today's approval cards, so the person who approves a message sees the pictures that go with it.
 */
export function MessagePhotos({ media, words, size = "sm" }: { media: readonly { position: number; thumb_url: string | null }[]; words: TodayWords; size?: "sm" | "md" }) {
  if (media.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" data-part="message-photos">
      {media.map((m, i) => (
        <li key={m.position} className={`overflow-hidden rounded-lg border border-line ${size === "md" ? "w-20" : "w-14"}`}>
          <Photo src={m.thumb_url} width={4} height={5} alt={say(words, "catalogue.thumb.alt", { n: i + 1, total: media.length })} words={words} />
        </li>
      ))}
    </ul>
  );
}
