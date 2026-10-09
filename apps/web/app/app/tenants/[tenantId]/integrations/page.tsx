import { StubPage } from "../stub-page";

export const metadata = { title: "Integrations · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

export default function IntegrationsPage({ params }: PageProps<"/app/tenants/[tenantId]/integrations">) {
  return <StubPage params={params} item="integrations" />;
}
