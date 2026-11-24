"use client";

import { useRouter } from "next/navigation";

import { fieldCls } from "../../settings/simple/fields";
import { Choose, Sentence } from "../rules/parts";

/** One choice inside a sentence that is also an address: each option is where the page goes when it is picked. */
export type LinkChoice = { /** what the choice is called for a screen reader */ label: string; value: string; options: readonly { value: string; text: string; href: string }[] };

/**
 * A sentence with the choices inside it ("Show [all] calls from [any time]."), for the pages whose filters live in the address (Calls, Leads, Reports, Catalogue). Picking an option goes to the SAME address the old chip, link or dropdown led to,
 * so the list is the same, can be shared and walked back. `{name}` in the template is replaced by the pill for `choices[name]`. (JOBS only; a lazy chunk, see LazyLinkSentence.)
 */
export function LinkSentence({ line, template, choices, className, plain = false }: { line: string; template: string; choices: Readonly<Record<string, LinkChoice>>; className?: string; /** FILTERS_OPEN: no sentence, each choice a labelled outlined dropdown (the template is not drawn). */ plain?: boolean }) {
  const router = useRouter();
  if (plain) {
    return (
      <div data-line={line} data-plain="" className={`flex flex-wrap items-end gap-3 ${className ?? ""}`.trim()}>
        {Object.entries(choices).map(([name, c]) => (
          <label key={name} className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-ink">
            {c.label}
            <select
              value={c.value}
              onChange={(e) => {
                const to = c.options.find((o) => o.value === e.target.value);
                if (to) router.push(to.href);
              }}
              className={`${fieldCls} min-w-[11rem] font-normal`}
            >
              {c.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }
  const parts = Object.fromEntries(
    Object.entries(choices).map(([name, c]) => [
      name,
      () => (
        <Choose
          aria={c.label}
          value={c.value}
          options={c.options.map((o) => o.value)}
          text={(v) => c.options.find((o) => o.value === v)?.text ?? v}
          onChange={(v) => {
            const to = c.options.find((o) => o.value === v);
            if (to) router.push(to.href);
          }}
        />
      ),
    ]),
  );
  return <Sentence line={line} template={template} parts={parts} className={className} />;
}
