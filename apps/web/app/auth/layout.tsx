import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthFrame } from "@/components/v2/auth/AuthFrame";

/**
 * The frame of the sign-in and account screens (Stage 3). Only the frame and one metadata export: no session read, no
 * redirect, no action, no data. The pages below keep their own <main>, h1 and title; the frame says "do not index".
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
