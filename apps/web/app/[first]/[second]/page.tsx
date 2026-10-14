import type { Metadata } from "next";

import { SiteRoute, siteMetadataFor } from "../../site-route";

type Props = { params: Promise<{ first: string; second: string }> };

/** "/te/pricing", "/hi/construction", ...: a page in Telugu, Hindi or Kannada (see app/site-route.tsx). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { first, second } = await params;
  return siteMetadataFor([first, second]);
}

export default async function SiteSecondPage({ params }: Props) {
  const { first, second } = await params;
  return <SiteRoute segments={[first, second]} />;
}
