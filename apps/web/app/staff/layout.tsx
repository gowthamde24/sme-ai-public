import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { v2FontClassName } from "@/design/fonts";
import { staffConsole } from "@/lib/screens/flag";

import "./staff.css";

// Stack19's own staff screens: never indexed, never cached, and (with the flag off) not there at all.
export const metadata: Metadata = { title: "Staff console · Stack19", robots: { index: false, follow: false, nocache: true } };

/**
 * The frame of the STAFF CONSOLE (owner, 13 Nov 2026): a separate app area at /staff with its own look (staff.css, scoped to [data-staff]) and none of the shop app's menu or workspace layout. `STAFF_CONSOLE` unset = a plain 404. Signing in is the proxy's job (it sends a
 * signed-out visitor to /login) and the API's (every call needs a staff row and the second factor); this layout decides nothing about access.
 */
export default function StaffLayout({ children }: { children: ReactNode }) {
  if (staffConsole() === "off") notFound();
  return (
    <div data-staff className={v2FontClassName("en")} lang="en">
      {children}
    </div>
  );
}
