import type { Metadata } from "next";

import { SiteRoute, siteMetadataFor } from "../../../site-route";

type Props = { params: Promise<{ first: string; second: string; third: string }> };

/** "/te/help/set-up-your-assistant": a help article in Telugu, Hindi, Kannada or Tamil (see app/site-route.tsx). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { first, second, third } = await params;
  return siteMetadataFor([first, second, third]);
}

export default async function SiteThirdPage({ params }: Props) {
  const { first, second, third } = await params;
  return <SiteRoute segments={[first, second, third]} />;
}
