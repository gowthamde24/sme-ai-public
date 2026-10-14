import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * "Continue with e-mail" on the second sign-up step (job CL): a native <details>, so it opens with no script and a keyboard or a screen reader can use it. Closed, it looks like the other two buttons; open, it
 * shows the address and password form. Nothing is hidden from a person who cannot run script.
 */
export function EmailDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group mt-3" data-signup="email">
      <summary className="flex min-h-12 w-full cursor-pointer list-none items-center justify-center gap-2 rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-ink hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="size-5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}
