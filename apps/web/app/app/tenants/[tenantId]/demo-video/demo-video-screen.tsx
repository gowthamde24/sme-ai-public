import { DemoVideo } from "@/components/v2/app/demo-video/LazyDemoVideo";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

import { readFrameData } from "../../../frame-data";

/** The words the story's screens draw: Today (its cards, the assistant's bar, the side cards), the WhatsApp chat, Prospects (the Lead Finder, the practice call, the draft quote) and the shared parts. */
const PREFIXES = ["today.", "agent.", "frame.", "ask.", "bv.", "owl.", "office.", "nav.item.", "visits.", "outbox.", "catalogue.", "common.", "wa.", "lf.", "dta.btn.", "apierr.", "problem."] as const;

/** The moment the page is drawn (ms): every time on the story's screens is relative to it. */
const clock = (): number => Date.now();

/**
 * Today in the demo-video mode (job demo-video; lib/demo-video/guard.ts has already said yes): the story of the video, drawn in the browser from fixtures. The server only resolves the words in the person's language, the moment
 * of the page and the frame's own numbers (plan, AI usage, the menu of the business type); it hands the story no token and no action, and no record of the workspace is read for it.
 */
export async function DemoVideoScreen({ accessToken, tenantId }: { accessToken: string; tenantId: string }) {
  const lang = await getLang();
  const frame = await readFrameData(accessToken, tenantId, lang);
  return <DemoVideo words={wordsFor(lang, PREFIXES)} base={`/app/tenants/${tenantId}`} lang={lang} now={clock()} frame={frame} />;
}
