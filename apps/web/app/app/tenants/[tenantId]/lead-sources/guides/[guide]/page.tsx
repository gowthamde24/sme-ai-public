import { notFound } from "next/navigation";

import { GuideView } from "@/components/v2/app/lead-desk/GuideView";
import { PageTop } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { GUIDES, WORKS_WITH, isGuide, mailFor } from "@/lib/lead-desk/guides";
import { ADDRESSES } from "@/lib/site/business";

import { leadDeskContext } from "../../../lead-desk-prelude";

export const metadata = { title: `Lead source guide · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /lead-sources/guides/[guide] (Owner and Admin): the steps and the lines to copy for one way leads reach the product, with "Email this to my developer" (a prepared mail) and "Have us set it up" (a prepared mail to us). No backend: the text is data. */
export default async function GuidePage({ params }: PageProps<"/app/tenants/[tenantId]/lead-sources/guides/[guide]">) {
  const { tenantId, guide } = await params;
  if (!isGuide(guide)) notFound();
  const got = await leadDeskContext(tenantId, ["owner", "admin"]);
  if (!got.ok) return got.page;
  const lang = await getLang();
  const words = wordsFor(lang, ["lsg."]);
  const g = GUIDES[guide];
  const title = words[`lsg.${guide}.t`] ?? guide;
  const mail = mailFor(title, guide);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={words[`lsg.${guide}.x`]} />
      <GuideView
        back={`/app/tenants/${tenantId}/lead-sources`}
        backWord={words["lsg.back"] ?? ""}
        steps={g.steps}
        code={g.code}
        works={g.works === true}
        workWith={WORKS_WITH}
        note={words["lsg.address.note"] ?? ""}
        mailHref={`mailto:?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}
        mailWord={words["lsg.mail"] ?? ""}
        setupHref={`mailto:${ADDRESSES.hello}?subject=${encodeURIComponent(`Please set up: ${title}`)}&body=${encodeURIComponent("Hello,\n\nPlease set this up for my business.\n")}`}
        setupWord={words["lsg.setup"] ?? ""}
        setupNote={words["lsg.setup.note"] ?? ""}
        lang={lang}
      />
    </main>
  );
}
