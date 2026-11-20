"use client";

import Link from "next/link";
import * as React from "react";

/**
 * The sticky bottom bar of the home page on a phone (under 900 px; hidden by the style sheet above that): "Get free early access", 48 px tall, safe-area padding. It is out of the way while the hero's own button, the final call to action or
 * the footer is on screen (an IntersectionObserver), so it never covers or doubles a button; it slides in with a transform only (no layout shift) and is `inert` while hidden.
 */
export function StickyCta({ href, label, arrow }: { href: string; label: string; /** The arrow, drawn on the server (no icon code in the page's script). */ arrow: React.ReactNode }) {
  const [seen, setSeen] = React.useState<Set<string>>(() => new Set(["hero"]));
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets: [string, Element | null][] = [
      ["hero", document.querySelector('[data-part="hero-cta"]')],
      ["final", document.querySelector("#demo, #join")],
      ["footer", document.querySelector("footer")],
    ];
    const io = new IntersectionObserver((es) => {
      setSeen((prev) => {
        const next = new Set(prev);
        for (const e of es) {
          const id = targets.find(([, el]) => el === e.target)?.[0];
          if (!id) continue;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    });
    for (const [, el] of targets) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);
  const show = seen.size === 0;
  return (
    <div className="h3-sticky" data-show={show ? "" : undefined} inert={!show} data-part="sticky-cta">
      <Link href={href} className="h3-btn h3-btn-main h3-btn-block">
        {label}
        {arrow}
      </Link>
    </div>
  );
}
