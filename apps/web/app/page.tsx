// "/" is the public landing page (design v2, Stage 2 flip). One implementation, two routes: /landing stays, unchanged
// (noindex, cookie-driven language and theme), and "/" renders the very same page and metadata.
export { default, generateMetadata } from "@/app/landing/page";
