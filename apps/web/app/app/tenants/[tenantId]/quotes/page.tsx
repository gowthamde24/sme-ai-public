import { StubPage } from "../stub-page";

export const metadata = { title: "Quotes · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

export default function QuotesPage({ params }: PageProps<"/app/tenants/[tenantId]/quotes">) {
  return <StubPage params={params} item="quotes" />;
}
