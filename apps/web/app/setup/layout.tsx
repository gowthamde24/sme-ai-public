import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthFrame } from "@/components/v2/auth/AuthFrame";

/** The frame of the first-login set-up screen: the sign-in frame. The page itself requires a session. "Do not index". */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
