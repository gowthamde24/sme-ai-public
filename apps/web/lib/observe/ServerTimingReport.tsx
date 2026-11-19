import { headers } from "next/headers";

import { settled } from "./server-timing";
import { inTimingScope, round1, serverTimingOn, SPAN_NAME } from "./timing-format";

/**
 * The render's spans, at the END of the HTML stream (SERVER_TIMING=1 only; mounted by app/app/layout.tsx inside its own Suspense, so it never holds back a paint). It waits until the render's reads have finished (server-timing.ts `settled`),
 * then writes ONE `<template id="srv-timing" data-spans="...">` (data in an attribute, never run; no inline script) and ONE log line `[server-timing] {...}` (Cloud Run's log). `s` = start in ms after the proxy took the request (header `x-sme-t0`, set by
 * proxy.ts), `d` = how long it ran. Numbers and fixed span names only. Docs: ~/Desktop/stack19-jobs/reports/first-byte.md.
 */
export async function ServerTimingReport() {
  if (!serverTimingOn()) return null;
  const h = await headers();
  if (!inTimingScope((h.get("x-sme-path") ?? "").split("?")[0])) return null;
  const t0 = Number(h.get("x-sme-t0"));
  const spans = await settled();
  const base = Number.isFinite(t0) && t0 > 0 ? t0 : (spans[0]?.s ?? 0);
  const json = JSON.stringify({ v: 1, spans: spans.filter((x) => SPAN_NAME.test(x.n)).map((x) => ({ n: x.n, s: round1(x.s - base), d: round1(x.d) })) });
  console.info("[server-timing]", json);
  // (an attribute, not an inline script: no component injects raw HTML, test/guards.test.ts; React escapes the attribute value)
  return <template id="srv-timing" data-spans={json} />;
}
