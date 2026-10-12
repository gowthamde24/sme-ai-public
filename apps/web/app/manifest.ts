import type { MetadataRoute } from "next";

import { SHORT_NAME } from "@/design/brand";

/**
 * The web app manifest (job BL): what the phone needs to install Sme-AI to the home screen. The icons are the Agent OWL set drawn from the owl SVG (public/icons, scripts/pwa-icons.mjs); the colours are
 * the v2 tokens (design/tokens.css: --v2-bg, --v2-brand). It opens on /app: a signed-out visitor is sent to sign in, a signed-in one lands on their workspace. No customer data is in it.
 * The name has no language of its own (a product name), the description is English.
 */
export const APP_NAME = SHORT_NAME;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Your AI team for the shop: Agent OWL helps with enquiries, quotes, visits and follow-ups. You stay in control.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f9f8f6",
    theme_color: "#ff773c",
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      ...[48, 72, 96, 128, 144, 152, 192, 256, 384, 512].map((size) => ({ src: `/icons/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" as const })),
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" as const },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" as const },
    ],
  };
}
