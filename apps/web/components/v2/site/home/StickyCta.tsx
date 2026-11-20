"use client";

import Link from "next/link";
import * as React from "react";

/**
 * The sticky bottom bar of the home page on a phone (under 900 px; hidden by the style sheet above that): "Get free early access", 48 px tall, safe-area padding. It is out of the way while the hero's own button, the final call to action or
 * the footer is on screen (an IntersectionObserver), so it never covers or doubles a button; it slides in with a transform only (no layout shift) and is `inert` while hidden.
 */
export function StickyCta({ href, label, arrow }: { href: string; label: string; /** The arrow, drawn on the server (no icon code in the page's script). */ arrow: React.ReactNode }) {
  const [on, setOn] = React.useState(1); // how many of the three watched places (the hero button, the final call to action, the footer) are on screen: the hero's, until the observer says
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const live = new Set<Element>();
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) live.add(e.target);
      else live.delete(e.target);
      setOn(live.size);
    });
    for (const el of [document.querySelector('[data-part="hero-cta"]'), document.querySelector("#demo, #join"), document.querySelector("footer")]) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);
  const show = on === 0;
  return (
    <div className="h3-sticky" data-show={show ? "" : undefined} inert={!show} data-part="sticky-cta">
      <Link href={href} className="h3-btn h3-btn-main h3-btn-block">
        {label}
        {arrow}
      </Link>
    </div>
  );
}
