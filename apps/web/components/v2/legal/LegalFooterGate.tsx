"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The legal row at the foot of the signed-in frame (owner, 26 Nov 2026: "it looks heavy on every page"): drawn only OUTSIDE a workspace, i.e. on the workspace list and the account pages, where it stays for legal reasons. Inside a workspace
 * (`/app/tenants/<id>/...`) the same five links are in Settings > Privacy and legal and in the ? menu. The links themselves are drawn on the server and passed as `children`.
 */
export function LegalFooterGate({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "";
  if (/^\/app\/tenants\//.test(path)) return null;
  return <>{children}</>;
}
