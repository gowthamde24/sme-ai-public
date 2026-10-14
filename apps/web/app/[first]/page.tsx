import type { Metadata } from "next";

import { SiteRoute, siteMetadataFor } from "../site-route";

type Props = { params: Promise<{ first: string }> };

/** "/te", "/hi", "/kn" (the home page in that language) and "/pricing", "/construction", ... (a page in English): see app/site-route.tsx. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return siteMetadataFor([(await params).first]);
}

export default async function SiteFirstPage({ params }: Props) {
  return <SiteRoute segments={[(await params).first]} />;
}
