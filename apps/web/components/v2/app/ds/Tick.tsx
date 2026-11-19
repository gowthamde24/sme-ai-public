import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * A ROUND tick box or radio with its label (Jobs design system, owner 19 Nov: no square checkboxes anywhere). The input is the real native one (the form, the keyboard and the screen reader work as always); design/jobs.css draws it round under JOBS.
 * The whole row is the tap area (44px high). `sub` is one short help line under the label.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & { label: ReactNode; sub?: ReactNode };

function Choice({ kind, label, sub, className = "", ...input }: Props & { kind: "checkbox" | "radio" }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-3 py-2 ${className}`.trim()}>
      <input type={kind} className="mt-px" {...input} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {sub ? <span className="block text-sm text-muted">{sub}</span> : null}
      </span>
    </label>
  );
}
export const Tick = (props: Props) => <Choice kind="checkbox" {...props} />;
export const Radio = (props: Props) => <Choice kind="radio" {...props} />;
