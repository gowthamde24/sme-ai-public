import type { ReactNode } from "react";

/** The line icons of the staff console (the paths of the approved mock). Decorative: always hidden from a screen reader (the words beside them say it). */
const PATHS: Record<string, ReactNode> = {
  overview: <path d="M4 11l8-7 8 7v9H4z" />,
  businesses: (
    <>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" />
    </>
  ),
  money: <path d="M7 5h10M7 9h10M8 5c5 0 6 8 0 8h-1l7 7" />,
  usage: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  health: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  compliance: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  audit: (
    <>
      <path d="M6 3h9l5 5v13H6z" />
      <path d="M15 3v5h5M9 13h7M9 17h7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

export function StaffIcon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name] ?? null}
    </svg>
  );
}
