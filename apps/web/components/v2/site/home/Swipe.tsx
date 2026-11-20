"use client";

import * as React from "react";

/**
 * A row of cards that swipes sideways on a phone (scroll-snap, the next card peeks in) and lies side by side from 768 px (design/home4.css). The dots under it say where you are and move the row; they are drawn for the phone only. The row is a
 * real scrolling list: it works with a finger, a trackpad, the keyboard (it takes focus) and with JavaScript off (the dots are then only a picture). `order` (CSS) may put a card first on the phone, so the dots follow the cards as they SIT, left to right.
 */
export function Swipe({ label, dotWord, className = "", children }: { label: string; dotWord: string; className?: string; children: React.ReactNode[] }) {
  const track = React.useRef<HTMLUListElement>(null);
  const [at, setAt] = React.useState(0);
  const slides = (): HTMLElement[] => (track.current ? ([...track.current.children] as HTMLElement[]).sort((a, b) => a.offsetLeft - b.offsetLeft) : []);
  React.useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const list = slides();
      const x = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let d = Infinity;
      list.forEach((s, i) => {
        const dist = Math.abs(s.offsetLeft + s.offsetWidth / 2 - x);
        if (dist < d) {
          d = dist;
          best = i;
        }
      });
      // at the very end the last card is the one, even when it is narrower than the gap
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) best = list.length - 1;
      else if (el.scrollLeft <= 2) best = 0;
      setAt(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const go = (i: number) => {
    const el = track.current;
    const s = slides()[i];
    if (!el || !s) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    el.scrollTo({ left: s.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft || "0"), behavior: calm ? "auto" : "smooth" });
  };
  const n = children.length;
  return (
    <div className={`h4-swipe ${className}`}>
      {/* a scrolling region the keyboard can reach (arrow keys scroll it) */}
      <ul ref={track} className="h4-track" aria-label={label} tabIndex={0}>
        {children.map((c, i) => (
          <li key={i} className="h4-slide" data-slide={i + 1}>
            {c}
          </li>
        ))}
      </ul>
      <div className="h4-dots" role="group" aria-label={label}>
        {children.map((_, i) => (
          <button key={i} type="button" className="h4-dot" aria-label={dotWord.replace("{n}", String(i + 1)).replace("{total}", String(n))} aria-current={at === i ? "true" : undefined} onClick={() => go(i)}>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
