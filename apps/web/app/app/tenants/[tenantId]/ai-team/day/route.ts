import type { NextRequest } from "next/server";

import { dayOrToday, readDay } from "../ai-team-data";
import { jsonOk, teamRoute } from "../team-route";

export const dynamic = "force-dynamic";

/** GET …/ai-team/day?date= : the day of My AI team v2, for the page's polling (every 20 s while it is open and visible). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return teamRoute(request, tenantId, async (ctx) => jsonOk({ day: await readDay(ctx, dayOrToday(request.nextUrl.searchParams.get("date"))) }));
}
