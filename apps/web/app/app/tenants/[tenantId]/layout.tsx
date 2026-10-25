import { NO_FRAME_DATA } from "@/components/v2/app/contract";
import { ModuleGate } from "@/components/v2/app/frame-store";
import { ProblemView } from "@/components/v2/app/robust/ProblemView";
import { AskDock } from "@/components/v2/app/today/ask/AskDock";
import { ASK_WORD_KEYS } from "@/components/v2/app/today/ask/ask-words";
import { appDict, appT } from "@/i18n/app";
import { FrameDataSlot } from "@/components/v2/app/frame-store";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getLang } from "@/i18n/get-lang";
import { requireUser } from "@/lib/auth/session";

import { readFrameData } from "../../frame-data";
import { readAgentsCached } from "./today-read";

/**
 * The layout of one workspace. It draws nothing of its own: the frame is drawn by the layout of /app, which cannot know which workspace the address is in, so this one reads
 * what the frame shows for THIS workspace (the plan, the AI usage, the count on Today) and hands it to the frame. A page decides access as before; if a read fails the
 * frame says "Not available yet" in that one place and the page shows its own error.
 * It also draws the Ask dock (job DN): the question line of Today at the bottom of the main screens, only when the assistant can be asked (the same rule as Today's box: its state is idle or working).
 */
export default async function TenantLayout({ children, params }: LayoutProps<"/app/tenants/[tenantId]">) {
  const { tenantId } = await params;
  const user = await requireUser();
  const lang = await getLang();
  const data = isCanonicalUuid(tenantId) ? await readFrameData(user.accessToken, tenantId, lang) : NO_FRAME_DATA;
  // the 403 page for a MOVE inside the app to a part the business type does not have (job CL; a typed address is judged by template.tsx): made here, in the person's language, and drawn by the gate only when needed
  const dict = appDict(lang) as Record<string, string>;
  const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith("problem.")));
  const askable = isCanonicalUuid(tenantId) ? await assistantAskable(user.accessToken, tenantId) : false;
  const t = appT(lang);
  return (
    <>
      <FrameDataSlot data={data} />
      {/* a server with no pack routes gives no pack: the product as it always was, every page on */}
      {data.pack ? (
        <ModuleGate modules={data.pack.modules} fallback={<ProblemView kind={403} variant="module" labels={labels} homeHref={`/app/tenants/${tenantId}`} />}>
          {children}
        </ModuleGate>
      ) : (
        children
      )}
      {askable ? <AskDock lang={lang} base={`/app/tenants/${tenantId}`} words={Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, t(k)]))} /> : null}
    </>
  );
}

/** Whether the assistant can be asked right now. A read that fails says no: the dock is left out rather than shown with nothing behind it. */
async function assistantAskable(accessToken: string, tenantId: string): Promise<boolean> {
  try {
    const state = (await readAgentsCached(accessToken, tenantId)).find((a) => a.agent === "main")?.state;
    return state === "idle" || state === "working";
  } catch {
    return false;
  }
}
