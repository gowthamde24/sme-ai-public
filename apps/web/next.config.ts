import path from "node:path";

import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

const PUBLIC_FILE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
// the plush owlets' pictures (jobs CI and CJ) live under /owl/v4/<agent>/ (job DA): a changed picture goes to /owl/v5/ (components/v2/app/owl/owl-files.ts OWL_DIR), so a year and "immutable" is safe
const OWL_FILE_CACHE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  // Never advertise the framework.
  poweredByHeader: false,
  // job CL: `forbidden()` (a 403 page for a part the business type does not have, app/app/tenants/[tenantId]/template.tsx) is Next.js 16 experimental and off until asked for
  experimental: { authInterrupts: true },
  // job CM: the public paver calculator imports the quote engine's TypeScript (packages/quote-engine/ts, one level above this app, alias @quote-engine/construction); the bundler only reads files inside its root, so the root is the repository
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
      // the offline worker (job BL): always asked for again, so a new version is picked up at once; it may control the whole site
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      // the app icons and the share pictures (job CF): Next serves files of public/ with "max-age=0", so a returning visitor on a slow phone asked for every icon again. They are not fingerprinted (the manifest
      // and the page heads name them by path), so a day is fresh and a week may be served while it is checked in the background; a changed icon reaches people within a day. The hashed files under /_next/static are already "immutable".
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: PUBLIC_FILE_CACHE }] },
      { source: "/og/:path*", headers: [{ key: "Cache-Control", value: PUBLIC_FILE_CACHE }] },
      { source: "/owl/:path*", headers: [{ key: "Cache-Control", value: OWL_FILE_CACHE }] },
    ];
  },
};

export default nextConfig;
