import type { NextConfig } from "next";

import { securityHeaders } from "./lib/security/headers";

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
    ];
  },
};

export default nextConfig;
