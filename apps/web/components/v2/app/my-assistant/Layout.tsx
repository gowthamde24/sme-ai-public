import type { ReactNode } from "react";

/** The tabs row above, the tab's body on the left and the Practice panel on the RIGHT of every tab from 1280px wide (below that it stacks under the body: on a narrow laptop the two columns squeezed the form, audit 17 Nov). */
export function MyAssistantLayout({ tabs, body, panel }: { tabs: ReactNode; body: ReactNode; panel: ReactNode }) {
  return (
    <>
      <div className="mt-5">{tabs}</div>
      <div className="mt-5 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="min-w-0">{body}</div>
        {panel}
      </div>
    </>
  );
}
