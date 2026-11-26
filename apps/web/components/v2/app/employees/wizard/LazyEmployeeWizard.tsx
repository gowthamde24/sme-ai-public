"use client";

import { Suspense, lazy, type ComponentProps } from "react";

const Wizard = lazy(() => import("./EmployeeWizard").then((m) => ({ default: m.EmployeeWizard })));

/** The wizard as its own lazy chunk, so the route's first JavaScript stays small (per-route budget). A quiet block of about its height is drawn while it loads. Same props as `EmployeeWizard`. */
export function EmployeeWizard(props: ComponentProps<typeof Wizard>) {
  return (
    <Suspense fallback={<span aria-hidden="true" data-skeleton="" className="jb-skeleton block h-[320px] rounded-xl" />}>
      <Wizard {...props} />
    </Suspense>
  );
}
