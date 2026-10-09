import { StubPage } from "../stub-page";

export const metadata = { title: "Office · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

export default function OfficePage({ params }: PageProps<"/app/tenants/[tenantId]/office">) {
  return <StubPage params={params} item="office" />;
}
