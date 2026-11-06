import { redirect } from "next/navigation";

import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";
import { demoVideoAllowed } from "@/lib/demo-video/guard";

import { DemoVideoScreen } from "./demo-video-screen";

/**
 * The demo video's own page (job demo-video): `/app/tenants/{id}/demo-video`, the hidden address of the story (any screen asked with `?demo=video` comes here; R starts it again, Escape leaves).
 * Drawn only where lib/demo-video/guard.ts says yes (the DEMO_VIDEO flag, the Owner or an Admin, a workspace the API calls a demo one); anyone else is sent to the normal Today. Its own route, so Today's first load carries none of it.
 */
export default async function DemoVideoPage({ params }: PageProps<"/app/tenants/[tenantId]/demo-video">) {
  const { tenantId } = await params;
  const user = await requireUser();
  if (!isCanonicalUuid(tenantId) || !(await demoVideoAllowed(user.accessToken, tenantId))) redirect(`/app/tenants/${isCanonicalUuid(tenantId) ? tenantId : ""}`);
  return DemoVideoScreen({ accessToken: user.accessToken, tenantId });
}
