import type { ReactNode } from "react";

import { LegalFrame } from "@/components/v2/legal/LegalFrame";

/** The frame of /privacy and /terms (job BH): public pages, in the visitor's language and theme, with the legal links in the footer. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return <LegalFrame>{children}</LegalFrame>;
}
