import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthFrame } from "@/components/v2/auth/AuthFrame";

/** The frame of the sign-up screens: the sign-in frame (header, language, theme, side panel), no session read, no data; "do not index". */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SignupLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
