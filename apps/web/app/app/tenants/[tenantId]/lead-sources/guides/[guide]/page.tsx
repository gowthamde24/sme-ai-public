import Link from "next/link";
import { notFound } from "next/navigation";

import { PageTop } from "@/components/v2/app/parts";
import { btnMainLink, btnQuiet, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { GUIDES, WORKS_WITH, isGuide, mailFor } from "@/lib/lead-desk/guides";

import { leadDeskContext } from "../../../lead-desk-prelude";

export const metadata = { title: `Lead source guide · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /lead-sources/guides/[guide] (Owner and Admin): the steps and the lines to copy for one way leads reach Stack19, with "Email this to my developer" (a prepared mail) and "Have us set it up" (a prepared mail to us). No backend: the text is data. */
export default async function GuidePage({ params }: PageProps<"/app/tenants/[tenantId]/lead-sources/guides/[guide]">) {
  const { tenantId, guide } = await params;
  if (!isGuide(guide)) notFound();
  const got = await leadDeskContext(tenantId, ["owner", "admin"]);
  if (!got.ok) return got.page;
  const lang = await getLang();
  const words = wordsFor(lang, ["lsg."]);
  const g = GUIDES[guide];
  const title = words[`lsg.${guide}.t`] ?? guide;
  const mail = mailFor(words[`lsg.${guide}.t`] ?? guide, guide);
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain} lang={lang}>
      <Link href={`${base}/lead-sources`} className="mb-1 inline-block py-1.5 text-[15px] font-semibold text-muted hover:text-ink">
        {words["lsg.back"]}
      </Link>
      <PageTop title={title} sub={words[`lsg.${guide}.x`]} />
      <div className="mt-4 flex max-w-3xl flex-col gap-4" lang="en">
        <ol className="m-0 flex list-none flex-col border-t border-ink p-0" data-part="guide-steps">
          {g.steps.map((s, i) => (
            <li key={s} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-line py-4">
              <span aria-hidden="true" className={`grid size-[30px] place-items-center rounded-full border text-[15px] font-bold ${i === 0 ? "border-ink bg-ink text-surface" : "border-line text-muted"}`}>
                {i + 1}
              </span>
              <p className="m-0 text-[16px] text-ink">{s}</p>
            </li>
          ))}
        </ol>
        {g.code ? (
          <pre data-part="guide-code" className="m-0 max-w-full overflow-x-auto rounded-[10px] border border-line px-3.5 py-3 font-mono text-[14px] leading-[1.55] text-ink">
            <code>{g.code}</code>
          </pre>
        ) : null}
        {g.works ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-part="works-with">
            {WORKS_WITH.map((w) => (
              <li key={w} className="rounded-full border border-line px-3 py-1 text-[14px] text-body">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="m-0 mt-4 border-y border-line py-3 text-[15px] text-muted" lang={lang}>
        {words["lsg.address.note"]}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3" lang={lang}>
        <a href={`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`} className={btnMainLink} data-part="mail-developer">
          {words["lsg.mail"]}
        </a>
        <a href={`mailto:hello@stack19.com?subject=${encodeURIComponent(`Please set up: ${title}`)}&body=${encodeURIComponent("Hello,\n\nPlease set this up for my business.\n")}`} className={btnQuiet} data-part="set-up-for-me">
          {words["lsg.setup"]}
        </a>
      </div>
      <p className="m-0 mt-2 text-[14px] text-muted" lang={lang}>
        {words["lsg.setup.note"]}
      </p>
    </main>
  );
}
