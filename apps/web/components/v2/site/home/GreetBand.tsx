"use client";

import * as React from "react";

/**
 * The greetings band (the owner's old favourite, back as the page's third and last motion): "నమస్కారం · नमस्ते · ನಮಸ್ಕಾರ · Hello" in big outlined lettering that slides sideways AS THE PAGE SCROLLS (transform only, one rAF per scroll frame, nothing runs while the band is off screen or with "reduce motion"), the word nearest the
 * middle filled with our orange (a filled copy of the same row shows through a window in the middle). The lettering is decoration (aria-hidden, drawn from `data-w` by CSS, so it is no text for the audits); the real sentence under it is plain text. The four product languages only: the assistant
 * does not speak Tamil. Still (no script, "reduce motion"): the Telugu word stands in the middle, filled.
 */
export function GreetBand({ words, line, label }: { words: string[]; line: string; label: string }) {
  const band = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = band.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    let on = false;
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height))); // 0 as it enters from below, 1 as it leaves at the top
      const set = el.querySelector<HTMLElement>("[data-set]")?.offsetWidth ?? 0; // one run of the four words
      el.style.setProperty("--gx", `${-p * set * 0.9}px`);
    };
    const onScroll = () => {
      if (on && !frame) frame = requestAnimationFrame(place);
    };
    const io = new IntersectionObserver((es) => {
      on = es.some((e) => e.isIntersecting);
      if (on) onScroll();
    });
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  const row = (spot: boolean) => (
    <div className={spot ? "h3-gspot" : "h3-gtrack"} aria-hidden="true" data-illustration="">
      <div className="h3-gmove">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h3-gset" data-set={n === 0 ? "" : undefined}>
            {words.map((w, i) => (
              <span key={i} className="h3-gw" data-w={w} lang={["te", "hi", "kn", "en"][i]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="h3-gband" ref={band} role="img" aria-label={label} data-part="greetings">
      {row(false)}
      {row(true)}
      <p className="h3-lead h3-gline">{line}</p>
    </div>
  );
}
