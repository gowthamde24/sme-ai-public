"use server";

import type { Reply } from "@/components/v2/app/cc/kit";
import { getLang } from "@/i18n/get-lang";
import type { SheetLoad } from "@/lib/jobs/templates";

import { DECIDERS, who } from "../retailers/finder-guard";
import { jobsRefusal } from "./refusal";
import { readSheetLoad } from "./sheet-load";

/**
 * The one read of the New job sheet (Owner and Admin): the ideas of the shop's business type and of the others, with what the previews are filled with (the shop's name, the main assistant's name, the person's language). Reads nothing that starts anything.
 * `null` data = the API has no ideas yet (the sheet still shows its box).
 */
export async function loadNewJobSheetAction(tenantId: string): Promise<Reply<SheetLoad | null>> {
  const ctx = await who(tenantId, DECIDERS);
  if ("ok" in ctx) return ctx;
  try {
    return { ok: true, data: await readSheetLoad(ctx.token, tenantId) };
  } catch (error) {
    return jobsRefusal(error, ctx.t, await getLang());
  }
}
