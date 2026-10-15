"use client";

import { primary } from "../visits/styles";

/** "Print or save as PDF": the browser's own print dialog, which offers "Save as PDF" on every phone and computer. Left out of the printed page. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className={`${primary} print:hidden`} onClick={() => window.print()}>
      {label}
    </button>
  );
}
