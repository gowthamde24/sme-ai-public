import { notFound } from "next/navigation";

import { PROBLEM_KINDS, ProblemView, type ProblemKind } from "@/components/v2/app/robust/ProblemView";
import { RefreshRetry } from "@/components/v2/app/robust/RetryButton";
import { appDict } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { requireUser } from "@/lib/auth/session";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Something is not right · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/problem/403, /429, /500 (and /404): the friendly pages of job BW as addresses, so that server code that has just met a refused or rate-limited call can `redirect()` to one. The page says only its closed
 * sentence, in the person's language; it takes no data from the address except which of the four it is.
 */
export default async function ProblemPage({ params }: PageProps<"/app/problem/[kind]">) {
  await requireUser();
  const { kind } = await params;
  const code = Number(kind) as ProblemKind;
  if (!PROBLEM_KINDS.includes(code)) notFound();
  const lang = await getLang();
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("problem.") || k.startsWith("notfound.")));
  return <ProblemView kind={code} labels={labels} action={code === 429 || code === 500 ? <RefreshRetry /> : undefined} />;
}
