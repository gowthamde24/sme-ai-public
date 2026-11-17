import { OfferFormPage } from "../pages";
import { campaignContext } from "../prelude";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `New offer · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/campaigns/new-offer: make an offer campaign (campaigns S4, behind OFFER_SCREENS; the page answers 404 while it is off). The page makes the campaign's id, so pressing Save twice is a retry. */
export default async function NewOfferRoute({ params }: PageProps<"/app/tenants/[tenantId]/campaigns/new-offer">) {
  const { tenantId } = await params;
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  return OfferFormPage({ ...got.ctx, campaignId: null });
}
