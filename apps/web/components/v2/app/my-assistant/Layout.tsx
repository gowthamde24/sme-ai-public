import type { ReactNode } from "react";

/**
 * My assistant's page: the Practice panel on the RIGHT from 1280 px wide (below that it stacks under the body: on a narrow laptop the two columns squeezed the form, audit 17 Nov). Train how it talks has its sections (`sections`): a list on the left from 1024 px, a select on a phone.
 * The Overview has none: the status card and the panel.
 */
export function MyAssistantLayout({ sections = null, body, panel }: { sections?: ReactNode; body: ReactNode; panel: ReactNode }) {
  const main = (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="min-w-0">{body}</div>
      {panel}
    </div>
  );
  if (!sections) return <div className="mt-5">{main}</div>;
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-6">
      {sections}
      {main}
    </div>
  );
}
