import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

// The golden screen texts (test/screens/__text__) hold dates and times as Node formats them for en-US in India ("Oct 6, 2026, 10:30 AM"). Node reads the default locale and zone from
// the environment, so on a machine set to another language or zone the same code prints "6 Oct 2026, 10:30 am" and 60+ goldens fail. Fixed here, before any worker starts, so the result
// does not depend on the machine. The app's own date formatting is not touched (it passes its locale and zone itself where it matters).
process.env.LANG = "en_US.UTF-8";
process.env.LC_ALL = "en_US.UTF-8";
process.env.TZ = "Asia/Kolkata";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname), "@quote-engine/construction": path.resolve(import.meta.dirname, "../../packages/quote-engine/ts/construction.ts") },
  },
  test: {
    environment: "jsdom",
    // A test that forgets to mock the API must not reach a real API on this machine (the local demo runs one on :8000, which answers 401 and
    // would send a page test to /login). ".invalid" never resolves, so an unmocked call fails the way "nothing is listening" always did.
    env: { NEXT_PUBLIC_API_BASE_URL: "http://api.invalid" },
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
    // The first test of a page file pays for importing the whole page (a few seconds on a busy CI machine): a test that only waits for that is not a failure. 5 s was the default; a test that really hangs still fails, 20 s later.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
