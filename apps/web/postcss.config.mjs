// The v2 styles use Tailwind v4 (ADR 0060). The plugin only transforms stylesheets that use Tailwind directives;
// the legacy app/globals.css passes through byte-identical (measured in Stage 0).
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
