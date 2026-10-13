import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

const PUBLIC_FILE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";
// the plush owlet's pictures (job CI follow-up) live under /owl/v2/: a changed picture goes to /owl/v3/ (components/v2/app/owl/plush-rig.ts OWL_DIR), so a year and "immutable" is safe
const OWL_FILE_CACHE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  // Never advertise the framework.
  poweredByHeader: false,
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
