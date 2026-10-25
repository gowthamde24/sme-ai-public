import Link from "next/link";

import { Orb } from "@/components/v2/Orb";

import { surface } from "../ui";
import { makeT, type Words } from "../words";

/** "Live now" on Today (job DM): a call that is going on, with the circle speaking, who is on the line and a link to listen. Drawn only when there is a live call (today only the pretend one of CALL_SCREENS=mock). */
export function LiveNowCard({ words, callee, info, href }: { words: Words; callee: string; info: string; href: string }) {
  const t = makeT(words);
  return (
    <section aria-labelledby="live-now-h" data-part="live-now" className={`${surface} flex items-center gap-4`}>
      <Orb px={48} state="speak" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="live-now-h" className="text-[15px] font-semibold">
          {t("call.now.title", { name: callee })}
        </h2>
        <p className="truncate text-sm text-muted">{info}</p>
      </div>
      <Link href={href} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-text hover:underline">
        {t("call.now.listen")}
      </Link>
    </section>
  );
}
