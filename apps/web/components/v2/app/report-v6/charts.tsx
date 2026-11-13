"use client";

import * as React from "react";

import { formatRupeesShort } from "@/lib/money";
import { areaPath, nearestIndex, niceScale, seriesPoints, smoothPath, type Pt } from "@/lib/reports-v6/chart-math";

/**
 * The two glossy line charts of the Reports page (approved mock), as plain SVG (no chart library) and one lazy chunk: "Enquiries and visits per day" (an orange to pink line with a soft glow and a thin highlight on top, a green line for visits, a gradient fill that fades out, dashed grid lines,
 * a glossy dot, a dark tooltip and a dashed guide line under the pointer or the arrow keys) and "Sales from visits" (the running total, the same style). The width follows its box (so a phone gets full width, no sideways scroll); the numbers are also in a table for screen readers
 * (drawn by the page). With "reduce motion" the lines are simply there; otherwise they draw themselves once.
 */
const PAD = { left: 38, right: 14, top: 14, bottom: 28 };

function useWidth(initial = 760): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(initial);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "");

export type DayLabel = { axis: string; full: string };

function XAxis({ labels, pts, y }: { labels: readonly DayLabel[]; pts: readonly Pt[]; y: number }) {
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((pts[pts.length - 1]?.x ?? 300) / 44))));
  return (
    <>
      {labels.map((l, i) =>
        pts[i] && (i % every === 0 || i === labels.length - 1) ? (
          <text key={i} x={pts[i].x} y={y} textAnchor="middle" fontSize="11" fill="var(--v2-muted)">
            {l.axis}
          </text>
        ) : null,
      )}
    </>
  );
}

/** Enquiries (orange to pink) and visits (green) per day. `tip` writes the tooltip's lines for one day. */
export function EnquiryChart({ labels, enquiries, visits, tip, summary }: { labels: readonly DayLabel[]; enquiries: readonly number[]; visits: readonly number[]; tip: (i: number) => { title: string; enquiries: string; visits: string }; summary: string }) {
  const [ref, w] = useWidth();
  const h = w < 420 ? 220 : 250;
  const uid = safeId(React.useId());
  const scale = niceScale(Math.max(0, ...enquiries, ...visits));
  const plot = { left: PAD.left, right: w - PAD.right, top: PAD.top, bottom: h - PAD.bottom };
  const pe = seriesPoints(enquiries, plot, scale.top);
  const pv = seriesPoints(visits, plot, scale.top);
  const [hover, setHover] = React.useState<number | null>(null);
  const at = hover ?? Math.max(0, enquiries.length - 1);
  const show = hover !== null;
  const t = pe.length ? tip(at) : null;
  const move = (x: number) => setHover(nearestIndex(pe, x));
  const tw = 146;
  const tx = pe[at] ? Math.min(Math.max(pe[at].x - tw / 2, 0), w - tw) : 0;
  return (
    <div ref={ref} className="w-full" data-chart="enquiries">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="block h-auto w-full touch-pan-y overflow-visible outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-brand"
        onPointerMove={(e) => move(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover(Math.min(enquiries.length - 1, (hover ?? at) + 1));
          else if (e.key === "ArrowLeft") setHover(Math.max(0, (hover ?? at) - 1));
          else if (e.key === "Escape") setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${uid}ae`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ds-ch-enq-2)" stopOpacity=".42" />
            <stop offset=".6" stopColor="var(--ds-ch-enq-2)" stopOpacity=".08" />
            <stop offset="1" stopColor="var(--ds-ch-enq-2)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}av`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ds-ch-vis-2)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--ds-ch-vis-2)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}le`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--ds-ch-enq-1)" />
            <stop offset=".5" stopColor="var(--ds-ch-enq-2)" />
            <stop offset="1" stopColor="var(--ds-ch-enq-3)" />
          </linearGradient>
          <linearGradient id={`${uid}lv`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--ds-ch-vis-1)" />
            <stop offset="1" stopColor="var(--ds-ch-vis-2)" />
          </linearGradient>
          <linearGradient id={`${uid}sh`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ds-ch-white)" stopOpacity=".55" />
            <stop offset="1" stopColor="var(--ds-ch-white)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}dot`}>
            <stop offset="0" stopColor="var(--ds-ch-white)" />
            <stop offset=".45" stopColor="var(--ds-ch-white)" />
            <stop offset=".5" stopColor="var(--ds-ch-enq-2)" />
            <stop offset="1" stopColor="var(--ds-ch-enq-3)" />
          </radialGradient>
          <filter id={`${uid}glow`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {scale.ticks.map((v, i) => {
          const y = plot.bottom - ((plot.bottom - plot.top) * v) / scale.top;
          return (
            <g key={v}>
              <line x1={plot.left} x2={plot.right} y1={y} y2={y} stroke="var(--v2-border)" strokeDasharray={i === 0 ? "0" : "3 5"} />
              <text x={plot.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="var(--v2-muted)">
                {v}
              </text>
            </g>
          );
        })}
        {pe.length > 1 ? (
          <>
            <path d={areaPath(pe, plot.bottom)} fill={`url(#${uid}ae)`} />
            <path d={areaPath(pv, plot.bottom)} fill={`url(#${uid}av)`} />
            <path d={smoothPath(pe)} pathLength={1} fill="none" stroke={`url(#${uid}le)`} strokeWidth="3.5" strokeLinecap="round" filter={`url(#${uid}glow)`} className="ds-draw" />
            <path d={smoothPath(pe)} fill="none" stroke={`url(#${uid}sh)`} strokeWidth="1.2" strokeLinecap="round" transform="translate(0,-1.2)" />
            <path d={smoothPath(pv)} pathLength={1} fill="none" stroke={`url(#${uid}lv)`} strokeWidth="3" strokeLinecap="round" filter={`url(#${uid}glow)`} className="ds-draw" />
          </>
        ) : null}
        <XAxis labels={labels} pts={pe} y={h - 8} />
        {pe[at] ? (
          <>
            {show ? <line x1={pe[at].x} x2={pe[at].x} y1={plot.top} y2={plot.bottom} stroke="var(--v2-ink)" strokeOpacity=".18" strokeDasharray="3 4" /> : null}
            <circle cx={pe[at].x} cy={pe[at].y} r="11" fill="var(--ds-ch-enq-2)" opacity=".18" />
            <circle cx={pe[at].x} cy={pe[at].y} r="6.5" fill={`url(#${uid}dot)`} stroke="var(--ds-ch-white)" strokeWidth="2" />
            <circle cx={pv[at].x} cy={pv[at].y} r="5.5" fill="var(--ds-ch-vis-2)" stroke="var(--ds-ch-white)" strokeWidth="2" />
          </>
        ) : null}
        {show && t && pe[at] ? (
          <g transform={`translate(${tx},${Math.max(pe[at].y - 74, -10)})`} pointerEvents="none" data-part="chart-tip">
            <rect width={tw} height="58" rx="12" fill="var(--ds-ch-tip)" />
            <text x="12" y="20" fontSize="11" fill="var(--ds-ch-tip-mut)">
              {t.title}
            </text>
            <circle cx="16" cy="34" r="4" fill="var(--ds-ch-enq-2)" />
            <text x="26" y="38" fontSize="12.5" fill="var(--ds-ch-white)" fontWeight="700">
              {t.enquiries}
            </text>
            <circle cx="16" cy="49" r="4" fill="var(--ds-ch-vis-2)" />
            <text x="26" y="53" fontSize="12.5" fill="var(--ds-ch-white)" fontWeight="700">
              {t.visits}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** Sales from visits: the running total across the period. A total is written in rupees here, in the browser (a function cannot be a prop from the server page). */
export function SalesChart({ labels, totals, summary }: { labels: readonly DayLabel[]; totals: readonly number[]; summary: string }) {
  const [ref, w] = useWidth(520);
  const h = 170;
  const uid = safeId(React.useId());
  const top = Math.max(1, ...totals);
  const plot = { left: 8, right: w - 12, top: 14, bottom: h - 24 };
  const pts = seriesPoints(totals, plot, top);
  const [hover, setHover] = React.useState<number | null>(null);
  const at = hover ?? Math.max(0, totals.length - 1);
  const tw = 128;
  const tx = pts[at] ? Math.min(Math.max(pts[at].x - tw / 2, 0), w - tw) : 0;
  return (
    <div ref={ref} className="w-full" data-chart="sales">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={summary}
        tabIndex={0}
        className="block h-auto w-full touch-pan-y overflow-visible outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-brand"
        onPointerMove={(e) => setHover(nearestIndex(pts, e.clientX - e.currentTarget.getBoundingClientRect().left))}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setHover(Math.min(totals.length - 1, (hover ?? at) + 1));
          else if (e.key === "ArrowLeft") setHover(Math.max(0, (hover ?? at) - 1));
          else if (e.key === "Escape") setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${uid}ga`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ds-ch-vis-2)" stopOpacity=".4" />
            <stop offset="1" stopColor="var(--ds-ch-vis-2)" stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}glow`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line x1={plot.left} x2={plot.right} y1={plot.bottom} y2={plot.bottom} stroke="var(--v2-border)" />
        {pts.length > 1 ? (
          <>
            <path d={areaPath(pts, plot.bottom)} fill={`url(#${uid}ga)`} />
            <path d={smoothPath(pts)} pathLength={1} fill="none" stroke="var(--ds-ch-vis-2)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${uid}glow)`} className="ds-draw" />
          </>
        ) : null}
        {labels.length ? (
          <>
            <text x={plot.left} y={h - 6} fontSize="11" fill="var(--v2-muted)">
              {labels[0].axis}
            </text>
            {labels.length > 1 ? (
              <text x={plot.right} y={h - 6} textAnchor="end" fontSize="11" fill="var(--v2-muted)">
                {labels[labels.length - 1].axis}
              </text>
            ) : null}
          </>
        ) : null}
        {pts[at] ? (
          <>
            {hover !== null ? <line x1={pts[at].x} x2={pts[at].x} y1={plot.top} y2={plot.bottom} stroke="var(--v2-ink)" strokeOpacity=".18" strokeDasharray="3 4" /> : null}
            <circle cx={pts[at].x} cy={pts[at].y} r="5" fill="var(--ds-ch-vis-2)" stroke="var(--v2-surface)" strokeWidth="2" />
          </>
        ) : null}
        {hover !== null && pts[at] ? (
          <g transform={`translate(${tx},${Math.max(pts[at].y - 48, -8)})`} pointerEvents="none" data-part="chart-tip">
            <rect width={tw} height="38" rx="10" fill="var(--ds-ch-tip)" />
            <text x="10" y="15" fontSize="10.5" fill="var(--ds-ch-tip-mut)">
              {labels[at]?.full}
            </text>
            <text x="10" y="31" fontSize="12.5" fill="var(--ds-ch-white)" fontWeight="700">
              {formatRupeesShort(totals[at])}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export function PrintButton({ label, className }: { label: string; className: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className} data-part="download-pdf">
      {label}
    </button>
  );
}
