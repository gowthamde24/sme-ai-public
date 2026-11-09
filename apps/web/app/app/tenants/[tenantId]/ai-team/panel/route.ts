import type { NextRequest } from "next/server";

import { HELPERS, type Helper } from "@/lib/api/ai-team";

import { readPanel } from "../ai-team-data";
import { jsonOk, teamRoute } from "../team-route";

export const dynamic = "force-dynamic";

/** GET …/ai-team/panel?helper= : one helper's side panel (its last 10 actions, today's numbers, cost, settings links, the switch). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const helper = request.nextUrl.searchParams.get("helper");
  if (!(HELPERS as readonly (string | null)[]).includes(helper)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return teamRoute(request, tenantId, async (ctx) => {
    const panel = await readPanel(ctx, helper as Helper);
    return panel ? jsonOk({ panel }) : new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  });
}
