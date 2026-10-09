import { StubPage } from "../stub-page";

export const metadata = { title: "Settings · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

export default function SettingsPage({ params }: PageProps<"/app/tenants/[tenantId]/settings">) {
  return <StubPage params={params} item="settings" />;
}
