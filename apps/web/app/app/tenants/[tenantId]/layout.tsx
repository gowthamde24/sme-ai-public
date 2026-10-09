import { NO_FRAME_DATA } from "@/components/v2/app/contract";
import { FrameDataSlot } from "@/components/v2/app/frame-store";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { readFrameData } from "../../frame-data";

/**
 * The layout of one workspace. It draws nothing of its own: the frame is drawn by the layout of /app, which cannot know which workspace the address is in, so this one reads
 * what the frame shows for THIS workspace (the plan, the AI usage, the count on Today) and hands it to the frame. A page decides access as before; if a read fails the
 * frame says "Not available yet" in that one place and the page shows its own error.
 */
export default async function TenantLayout({ children, params }: LayoutProps<"/app/tenants/[tenantId]">) {
  const { tenantId } = await params;
  const user = await requireUser();
  const data = isCanonicalUuid(tenantId) ? await readFrameData(user.accessToken, tenantId) : NO_FRAME_DATA;
  return (
    <>
      <FrameDataSlot data={data} />
      {children}
    </>
  );
}
